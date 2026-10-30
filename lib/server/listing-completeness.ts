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
  checkedAt: Date | null
}

type ObservationRow = {
  locationId: string
  resource: string
  observedAt: Date | null
  payloadObservedAt: string | null
  location: GoogleLocationFacts | null
  attributes: { attributes?: unknown[] } | null
}

type GoogleDate = { year?: number; month?: number; day?: number }

/** The parts of a stored Google location the checks read. */
type GoogleLocationFacts = {
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
  const cfg = COMPLETENESS_CONFIG

  const [observations, menus, posts, photos, booking, reviews, skips] =
    await Promise.all([
      // Every visible listing's stored profile reads (for sibling
      // descriptions); hours, posts and booking reads for the targets.
      sql<ObservationRow[]>`
        select
          location_id::text as "locationId",
          resource,
          observed_at as "observedAt",
          observed_google_payload ->> 'observedAt' as "payloadObservedAt",
          observed_google_payload -> 'location' as location,
          case when resource = 'businessInformation'
            then observed_google_payload -> 'attributes' end as attributes
        from presence_resource_reconcile_state
        where (
            location_id = any(${allIds}::uuid[])
            and resource in ('profile', 'businessInformation')
          ) or (
            location_id = any(${ids}::uuid[])
            and resource in ('hours', 'posts', 'placeActions')
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
      `,
      sql<{ locationId: string; lastPublishedAt: Date | null }[]>`
        select location_id::text as "locationId",
          max(provider_create_time) as "lastPublishedAt"
        from gbp_local_post
        where location_id = any(${ids}::uuid[]) and status = 'published'
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
          max(google_create_time) filter (where media_format = 'PHOTO') as "newestAt",
          coalesce(bool_or(upper(category) = 'COVER'), false) as cover,
          coalesce(bool_or(upper(category) in ('LOGO', 'PROFILE')), false) as logo,
          max(observed_at) as "observedAt"
        from gbp_media_item
        where location_id = any(${ids}::uuid[])
          and deleted_at is null and ownership = 'merchant'
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
          count(*) filter (
            where r.create_time >= ${now}::timestamptz - make_interval(days => ${cfg.ratingTrendWindowDays})
          )::int as "recentCount",
          avg(r.star_rating) filter (
            where r.create_time >= ${now}::timestamptz - make_interval(days => ${cfg.ratingTrendWindowDays})
          )::text as "recentAverage",
          count(*) filter (
            where r.create_time < ${now}::timestamptz - make_interval(days => ${cfg.ratingTrendWindowDays})
              and r.create_time >= ${now}::timestamptz - make_interval(days => ${2 * cfg.ratingTrendWindowDays})
          )::int as "previousCount",
          avg(r.star_rating) filter (
            where r.create_time < ${now}::timestamptz - make_interval(days => ${cfg.ratingTrendWindowDays})
              and r.create_time >= ${now}::timestamptz - make_interval(days => ${2 * cfg.ratingTrendWindowDays})
          )::text as "previousAverage"
        from review r
        where r.location_id = any(${ids}::uuid[])
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

  const profileRead = (locationId: string) =>
    newest(
      (observationsBy.get(locationId) ?? []).filter((row) =>
        (PROFILE_RESOURCES as readonly string[]).includes(row.resource)
      )
    )
  const siblings = visible.flatMap((row) => {
    const description = profileRead(row.locationId)?.location?.profile
      ?.description
    return description?.trim()
      ? [{ locationId: row.locationId, name: row.name, description }]
      : []
  })

  return targets.map((target) => {
    const rows = observationsBy.get(target.locationId) ?? []
    const byResource = (resource: string) =>
      rows.find((row) => row.resource === resource) ?? null
    const profile = profileRead(target.locationId)
    const businessInformation = byResource("businessInformation")
    const hours = byResource("hours")
    const menu = menusBy.get(target.locationId)
    const photo = photosBy.get(target.locationId)
    const links = bookingBy.get(target.locationId)
    const review = reviewsBy.get(target.locationId)
    const placeActionsRead = byResource("placeActions")
    const location = profile?.location
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
        : null,
      posts: {
        lastPublishedAt: iso(postsBy.get(target.locationId)?.lastPublishedAt),
        observedAt: iso(byResource("posts")?.observedAt),
      },
      photos: {
        newestAt: iso(photo?.newestAt),
        cover: photo?.cover ?? false,
        logo: photo?.logo ?? false,
        observedAt: iso(photo?.observedAt),
      },
      booking: {
        booking: links?.booking ?? 0,
        other: links?.other ?? 0,
        observedAt:
          [iso(placeActionsRead?.observedAt), iso(links?.observedAt)]
            .filter((at): at is string => at !== null)
            .sort()
            .at(-1) ?? null,
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
