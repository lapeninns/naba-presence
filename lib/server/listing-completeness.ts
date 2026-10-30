import "server-only"

import type { TransactionSql } from "postgres"

import {
  listingCompleteness,
  type CompletenessCheckId,
  type CompletenessInput,
  type CompletenessSkip,
  type ListingCompleteness,
  COMPLETENESS_CONFIG,
} from "@/lib/listings/completeness"
import { visibilityPredicate } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

/**
 * Listing completeness, read from what is already stored: earlier Google
 * observations, synced posts, photos, booking links, menus and reviews. Like
 * `readListingSummaries` it never calls Google, and each table is read once
 * for the whole set, so the board costs the same handful of queries as one
 * listing.
 */

/** Place action types that let a guest book, as opposed to order. */
const BOOKING_TYPES = [
  "DINING_RESERVATION",
  "APPOINTMENT",
  "ONLINE_APPOINTMENT",
]

/** The editors' stored reads that carry the Google location. */
const PROFILE_RESOURCES = ["profile", "businessInformation"] as const

type LocationRow = {
  locationId: string
  name: string
  linked: boolean
  verified: boolean | null
  externalLocationId: string | null
  googleLocationName: string | null
  checkedAt: Date | null
}

type ObservationRow = {
  locationId: string
  resource: string
  observedAt: Date | null
  lastSucceededAt: Date | null
  payloadObservedAt: string | null
  payloadLocationName: string | null
  location: GoogleLocationFacts | null
  attributes: { attributes?: unknown[] } | null
}

type GoogleDate = { year?: number; month?: number; day?: number }

/** The parts of a stored Google location the checks read. */
type GoogleLocationFacts = {
  name?: string
  metadata?: { canHaveFoodMenus?: boolean }
  phoneNumbers?: { primaryPhone?: string }
  websiteUri?: string
  profile?: { description?: string }
  categories?: {
    primaryCategory?: { displayName?: string; name?: string }
    additionalCategories?: unknown[]
  }
  serviceItems?: unknown[]
  regularHours?: { periods?: unknown[] }
  specialHours?: {
    specialHourPeriods?: { startDate?: GoogleDate; endDate?: GoogleDate }[]
  }
}

function isoDate(date: GoogleDate | undefined): string | null {
  if (!date?.year || !date.month || !date.day) return null
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`
}

function iso(date: Date | string | null | undefined): string | null {
  if (!date) return null
  return date instanceof Date ? date.toISOString() : date
}

/** When a stored read was made: the payload's own time, else the row's. */
function observedAt(row: ObservationRow): string | null {
  return row.payloadObservedAt ?? iso(row.observedAt)
}

function menuItems(menus: unknown): number {
  if (!Array.isArray(menus)) return 0
  let items = 0
  for (const menu of menus as { sections?: { items?: unknown[] }[] }[])
    for (const section of menu?.sections ?? [])
      items += Array.isArray(section?.items) ? section.items.length : 0
  return items
}

/** "accounts/1/locations/2" and "locations/2" name the same listing. */
function locationKey(name: string): string {
  const at = name.lastIndexOf("locations/")
  return at === -1 ? name : name.slice(at)
}

/** A later observation recorded without a payload (an hours publish) supersedes it. */
const SUPERSEDED_AFTER_MS = 60_000

/**
 * The stored Google location is usable: it is the latest observation of
 * the Google location linked now. A payload kept from before a later read
 * (an hours publish records its readback without one), or read from a
 * listing linked earlier, is no evidence of what Google shows today.
 */
function currentPayload(
  row: ObservationRow | null | undefined,
  googleLocationName: string | null
): ObservationRow | null {
  if (!row?.location) return null
  const name = row.payloadLocationName ?? row.location.name ?? null
  if (
    name &&
    googleLocationName &&
    locationKey(name) !== locationKey(googleLocationName)
  )
    return null
  const payloadAt = Date.parse(observedAt(row) ?? "")
  const rowAt = row.observedAt?.getTime()
  if (
    Number.isFinite(payloadAt) &&
    rowAt !== undefined &&
    rowAt - payloadAt > SUPERSEDED_AFTER_MS
  )
    return null
  return row
}

/** When a list (posts, photos, booking links) was last read from Google. */
function listReadAt(row: ObservationRow | null | undefined): string | null {
  return latest([iso(row?.observedAt), iso(row?.lastSucceededAt)])
}

function latest(values: readonly (string | null | undefined)[]): string | null {
  return (
    values
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null
  )
}

function newest(rows: readonly ObservationRow[]): ObservationRow | null {
  return rows.reduce<ObservationRow | null>((best, row) => {
    if (!row.location) return best
    if (!best) return row
    return (observedAt(row) ?? "") > (observedAt(best) ?? "") ? row : best
  }, null)
}

/**
 * Completeness for every requested listing the session may see. Pass no ids
 * for the whole directory. Sibling descriptions are compared only across the
 * listings the session may see.
 */
export async function readListingCompleteness(
  sql: TransactionSql,
  session: Session,
  locationIds?: readonly string[],
  now: Date = new Date()
): Promise<ListingCompleteness[]> {
  const visible = await sql<LocationRow[]>`
    select
      l.id::text as "locationId",
      l.name,
      (ll.id is not null) as linked,
      e.verified,
      e.id::text as "externalLocationId",
      e.google_location_name as "googleLocationName",
      (
        -- Successful review syncs only: a failed one never makes reviews look current.
        select max(sc.last_succeeded_at)
        from sync_checkpoint sc
        where sc.external_location_id = e.id
          and sc.sync_type in ('reconcile', 'backfill', 'sweep', 'notification')
      ) as "checkedAt"
    from location l
    left join location_link ll on ll.location_id = l.id and ll.is_active
    left join external_location e on e.id = ll.external_location_id
    where ${visibilityPredicate(sql, session, sql`l.id`)}
  `
  if (visible.length === 0) return []
  const requested =
    locationIds && locationIds.length > 0 ? new Set(locationIds) : null
  const targets = visible.filter(
    (row) => !requested || requested.has(row.locationId)
  )
  if (targets.length === 0) return []
  const allIds = sql.array(visible.map((row) => row.locationId))
  const ids = sql.array(targets.map((row) => row.locationId))
  // Synced items of the Google location linked now, not of one linked before.
  const externalIds = sql.array(
    targets.flatMap((row) =>
      row.externalLocationId ? [row.externalLocationId] : []
    )
  )
  const cfg = COMPLETENESS_CONFIG
  const ownedPhoto = sql`deleted_at is null and ownership = 'merchant' and media_format = 'PHOTO'`

  const [observations, menus, posts, photos, booking, reviews, skips] =
    await Promise.all([
      // Every visible listing's stored profile reads (for sibling
      // descriptions); hours, posts and booking reads for the targets.
      sql<ObservationRow[]>`
        select
          location_id::text as "locationId",
          resource,
          observed_at as "observedAt",
          last_succeeded_at as "lastSucceededAt",
          observed_google_payload ->> 'observedAt' as "payloadObservedAt",
          observed_google_payload ->> 'googleLocationName' as "payloadLocationName",
          observed_google_payload -> 'location' as location,
          case when resource = 'businessInformation'
            then observed_google_payload -> 'attributes' end as attributes
        from presence_resource_reconcile_state
        where (
            location_id = any(${allIds}::uuid[])
            and resource in ('profile', 'businessInformation')
          ) or (
            location_id = any(${ids}::uuid[])
            and resource in ('hours', 'posts', 'placeActions', 'media')
          )
      `,
      sql<
        {
          locationId: string
          eligible: boolean | null
          googlePayload: unknown
          observedAt: Date | null
        }[]
      >`
        select location_id::text as "locationId", eligible,
          google_payload as "googlePayload", observed_at as "observedAt"
        from food_menus_state
        where location_id = any(${ids}::uuid[])
          and external_location_id = any(${externalIds}::uuid[])
      `,
      sql<{ locationId: string; lastPublishedAt: Date | null }[]>`
        select location_id::text as "locationId",
          max(provider_create_time) as "lastPublishedAt"
        from gbp_local_post
        where location_id = any(${ids}::uuid[]) and status = 'published'
          and external_location_id = any(${externalIds}::uuid[])
        group by location_id
      `,
      sql<
        {
          locationId: string
          newestAt: Date | null
          cover: boolean
          logo: boolean
          observedAt: Date | null
        }[]
      >`
        select location_id::text as "locationId",
          max(google_create_time) filter (where ${ownedPhoto}) as "newestAt",
          coalesce(bool_or(upper(category) = 'COVER') filter (where ${ownedPhoto}), false) as cover,
          coalesce(bool_or(upper(category) in ('LOGO', 'PROFILE')) filter (where ${ownedPhoto}), false) as logo,
          -- Every row a read touched, kept or marked gone: a read that found
          -- no owner photos still says when Google was last asked.
          max(greatest(observed_at, deleted_at)) as "observedAt"
        from gbp_media_item
        where location_id = any(${ids}::uuid[])
          and external_location_id = any(${externalIds}::uuid[])
        group by location_id
      `,
      sql<
        {
          locationId: string
          booking: number
          other: number
          observedAt: Date | null
        }[]
      >`
        select location_id::text as "locationId",
          count(*) filter (where place_action_type = any(${BOOKING_TYPES}::text[]))::int as booking,
          count(*) filter (where not (place_action_type = any(${BOOKING_TYPES}::text[])))::int as other,
          max(observed_at) as "observedAt"
        from place_action_link
        where location_id = any(${ids}::uuid[]) and deleted_at is null
          and external_location_id = any(${externalIds}::uuid[])
        group by location_id
      `,
      sql<
        {
          locationId: string
          overdue: number
          recentCount: number
          recentAverage: string | null
          previousCount: number
          previousAverage: string | null
        }[]
      >`
        select r.location_id::text as "locationId",
          count(*) filter (
            where r.workflow_status in ('new', 'drafted', 'verified', 'rejected')
              and r.triaged_at is null
              and r.create_time < ${now}::timestamptz - make_interval(days => ${cfg.unrepliedReviewDays})
          )::int as overdue,
          count(r.star_rating) filter (
            where r.create_time >= ${now}::timestamptz - make_interval(days => ${cfg.ratingTrendWindowDays})
          )::int as "recentCount",
          avg(r.star_rating) filter (
            where r.create_time >= ${now}::timestamptz - make_interval(days => ${cfg.ratingTrendWindowDays})
          )::text as "recentAverage",
          count(r.star_rating) filter (
            where r.create_time < ${now}::timestamptz - make_interval(days => ${cfg.ratingTrendWindowDays})
              and r.create_time >= ${now}::timestamptz - make_interval(days => ${2 * cfg.ratingTrendWindowDays})
          )::int as "previousCount",
          avg(r.star_rating) filter (
            where r.create_time < ${now}::timestamptz - make_interval(days => ${cfg.ratingTrendWindowDays})
              and r.create_time >= ${now}::timestamptz - make_interval(days => ${2 * cfg.ratingTrendWindowDays})
          )::text as "previousAverage"
        from review r
        where r.location_id = any(${ids}::uuid[])
          and r.external_location_id = any(${externalIds}::uuid[])
          and r.provider_deleted_at is null
        group by r.location_id
      `,
      readCompletenessSkipRows(
        sql,
        targets.map((row) => row.locationId)
      ),
    ])

  const observationsBy = new Map<string, ObservationRow[]>()
  for (const row of observations) {
    const list = observationsBy.get(row.locationId) ?? []
    list.push(row)
    observationsBy.set(row.locationId, list)
  }
  const menusBy = new Map(menus.map((row) => [row.locationId, row]))
  const postsBy = new Map(posts.map((row) => [row.locationId, row]))
  const photosBy = new Map(photos.map((row) => [row.locationId, row]))
  const bookingBy = new Map(booking.map((row) => [row.locationId, row]))
  const reviewsBy = new Map(reviews.map((row) => [row.locationId, row]))
  const skipsBy = new Map<string, CompletenessSkip[]>()
  for (const skip of skips) {
    const list = skipsBy.get(skip.locationId) ?? []
    list.push({
      checkId: skip.checkId,
      reason: skip.reason,
      skippedAt: skip.skippedAt,
    })
    skipsBy.set(skip.locationId, list)
  }

  const googleNameBy = new Map(
    visible.map((row) => [row.locationId, row.googleLocationName])
  )
  const current = (locationId: string, resource: string) =>
    currentPayload(
      (observationsBy.get(locationId) ?? []).find(
        (row) => row.resource === resource
      ),
      googleNameBy.get(locationId) ?? null
    )
  const profileRead = (locationId: string) =>
    newest(
      PROFILE_RESOURCES.flatMap((resource) => {
        const row = current(locationId, resource)
        return row ? [row] : []
      })
    )
  const maxAgeMs = cfg.snapshotMaxAgeDays * 86_400_000
  const siblings = visible.flatMap((row) => {
    const read = profileRead(row.locationId)
    const description = read?.location?.profile?.description
    if (!read || !description?.trim()) return []
    // A description read long ago may have changed since: not compared.
    const age = now.getTime() - Date.parse(observedAt(read) ?? "")
    return age <= maxAgeMs
      ? [{ locationId: row.locationId, name: row.name, description }]
      : []
  })

  return targets.map((target) => {
    const rows = observationsBy.get(target.locationId) ?? []
    const byResource = (resource: string) =>
      rows.find((row) => row.resource === resource) ?? null
    const profile = profileRead(target.locationId)
    const businessInformation = current(
      target.locationId,
      "businessInformation"
    )
    const hours = current(target.locationId, "hours")
    const menu = menusBy.get(target.locationId)
    const photo = photosBy.get(target.locationId)
    const links = bookingBy.get(target.locationId)
    const review = reviewsBy.get(target.locationId)
    const location = profile?.location
    // Google's own word on whether the listing can have a food menu, for a
    // listing whose menu state was never read.
    const canHaveFoodMenus = location?.metadata?.canHaveFoodMenus
    const average = (value: string | null | undefined) =>
      value === null || value === undefined ? null : Number(value)

    const input: CompletenessInput = {
      locationId: target.locationId,
      linked: target.linked,
      verified: target.linked ? (target.verified ?? null) : null,
      profile:
        profile && location
          ? {
              observedAt: observedAt(profile) ?? "",
              value: {
                primaryCategory:
                  location.categories?.primaryCategory?.displayName ??
                  location.categories?.primaryCategory?.name ??
                  null,
                additionalCategories:
                  location.categories?.additionalCategories?.length ?? 0,
                phone: location.phoneNumbers?.primaryPhone ?? null,
                website: location.websiteUri ?? null,
                description: location.profile?.description ?? null,
              },
            }
          : null,
      hours: hours?.location
        ? {
            observedAt: observedAt(hours) ?? "",
            value: {
              regularPeriods: hours.location.regularHours?.periods?.length ?? 0,
              specialPeriods: (
                hours.location.specialHours?.specialHourPeriods ?? []
              ).flatMap((period) => {
                const start = isoDate(period.startDate)
                if (!start) return []
                return [{ start, end: isoDate(period.endDate) ?? start }]
              }),
            },
          }
        : null,
      details: businessInformation?.location
        ? {
            observedAt: observedAt(businessInformation) ?? "",
            value: {
              attributes: Array.isArray(
                businessInformation.attributes?.attributes
              )
                ? businessInformation.attributes.attributes.length
                : 0,
              serviceItems:
                businessInformation.location.serviceItems?.length ?? 0,
            },
          }
        : null,
      menu: menu?.observedAt
        ? {
            observedAt: menu.observedAt.toISOString(),
            value: {
              eligible: menu.eligible,
              items: menuItems(menu.googlePayload),
            },
          }
        : profile && canHaveFoodMenus === false
          ? {
              observedAt: observedAt(profile) ?? "",
              value: { eligible: false, items: 0 },
            }
          : null,
      posts: {
        lastPublishedAt: iso(postsBy.get(target.locationId)?.lastPublishedAt),
        observedAt: listReadAt(byResource("posts")),
      },
      photos: {
        newestAt: iso(photo?.newestAt),
        cover: photo?.cover ?? false,
        logo: photo?.logo ?? false,
        observedAt: latest([
          iso(photo?.observedAt),
          listReadAt(byResource("media")),
        ]),
      },
      booking: {
        booking: links?.booking ?? 0,
        other: links?.other ?? 0,
        observedAt: latest([
          listReadAt(byResource("placeActions")),
          iso(links?.observedAt),
        ]),
      },
      reviews: {
        checkedAt: iso(target.checkedAt),
        overdueUnreplied: review?.overdue ?? 0,
        recent: {
          count: review?.recentCount ?? 0,
          average: average(review?.recentAverage),
        },
        previous: {
          count: review?.previousCount ?? 0,
          average: average(review?.previousAverage),
        },
      },
      siblings: siblings.filter(
        (sibling) => sibling.locationId !== target.locationId
      ),
    }
    return listingCompleteness(input, skipsBy.get(target.locationId) ?? [], now)
  })
}

export type CompletenessSkipRow = {
  locationId: string
  checkId: CompletenessCheckId
  reason: string
  skippedAt: string
  skippedBy: string | null
}

/** Skips for the given listings. The caller has already scoped the ids. */
export async function readCompletenessSkipRows(
  sql: TransactionSql,
  locationIds: readonly string[]
): Promise<CompletenessSkipRow[]> {
  if (locationIds.length === 0) return []
  const rows = await sql<
    {
      locationId: string
      checkId: CompletenessCheckId
      reason: string
      skippedAt: Date
      skippedBy: string | null
    }[]
  >`
    select s.location_id::text as "locationId", s.check_id as "checkId",
      s.reason, s.created_at as "skippedAt",
      u.display_name as "skippedBy"
    from listing_completeness_skip s
    left join app_user u on u.id = s.created_by
    where s.location_id = any(${sql.array([...locationIds])}::uuid[])
    order by s.created_at
  `
  return rows.map((row) => ({ ...row, skippedAt: row.skippedAt.toISOString() }))
}

// INTEGRATION(S1): lib/server/prefetch.ts may seed the completeness queries
// (`completenessQueryKeys` in lib/listings/completeness-query.ts) from
// readListingCompleteness in listingsBoardPrefetch / listingPagePrefetch, so
// the column and card paint on first load instead of after one fetch.
