import "server-only"

import type { TransactionSql } from "postgres"

import {
  emptyListingSummary,
  type LastPublish,
  type ListingSummary,
  type SyncStatus,
  type SyncedArea,
} from "@/lib/contracts/location-summary"
import { compareMenuReplacement } from "@/lib/locations/menu-diff"
import { hashFoodMenus } from "@/lib/domain/food-menus"
import {
  hashHours,
  classifyHoursDrift,
  type NormalizedHours,
} from "@/lib/domain/hours"
import {
  classifyProfileField,
  hashProfileValue,
  PROFILE_FIELD_KEYS,
  type NormalizedProfile,
} from "@/lib/domain/profile"
import { visibilityPredicate } from "@/lib/server/permissions"
import type { HoursObservation } from "@/lib/server/hours-observations"
import type { Session } from "@/lib/server/session"

/**
 * The listing's state without opening any editor, and without Google.
 *
 * Every editor's GET reads Google live, paced at roughly two calls a second
 * per connection, so "is anything waiting on this listing" used to cost
 * seconds per listing. The answer is mostly already stored: the canonical
 * copy and the hashes each publish pinned as its baseline, the hashes each
 * observation recorded for Google's side, the cached snapshots of the
 * Google-direct areas, the local posts, the pending proposals and the
 * attempt tables. This reads those and nothing else.
 *
 * Two kinds of truth come back, and the contract keeps them apart:
 * - local edits versus the last published baseline are EXACT;
 * - Google-side drift is as of `observedAt`, the last time an editor or a
 *   sync read Google.
 */

type LinkRow = {
  locationId: string
  linked: boolean
  verified: boolean
  connectionStatus:
    "active" | "expired" | "revoked" | "error" | "disconnected" | null
  reconnectRequired: boolean | null
  googleEmail: string | null
  connectionErrorCode: string | null
  accessState: "ok" | "access_lost" | null
  lastCheckedAt: Date | null
  linkedAt: Date | null
}

export type CanonicalRow = {
  locationId: string
  resourceType: "profile" | "hours" | "food_menus"
  revision: number
  payload: unknown
  baselineCanonicalHash: string | null
  baselineGoogleHash: string | null
  lastReconciledAt: Date | null
}

export type ProfileFieldRow = {
  locationId: string
  fieldKey: string
  googleHash: string
  baselineCanonicalHash: string | null
  baselineGoogleHash: string | null
  observedAt: Date
  /** Google's Maps link for the listing, on the `mapsUrl` row only. */
  mapsUrl?: string | null
}

export type MenuStateRow = {
  googlePayload?: Array<Record<string, unknown>>
  canonicalPayload?: Array<Record<string, unknown>>
  locationId: string
  eligible: boolean
  canonicalHash: string
  googleHash: string
  observedAt: Date
}

type CountRow = { locationId: string; count: number }
type PostCountRow = { locationId: string; status: string; count: number }
type SuggestionRow = { locationId: string; resourceType: string; count: number }
type AttemptRow = {
  locationId: string
  area: string
  status: string
  at: Date
}

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

/** Uses persisted observation evidence; publication history never counts as a new check. */
export function hoursArea(
  row: CanonicalRow | undefined,
  observation?: HoursObservation
): SyncedArea {
  if (!row)
    return {
      status: "unknown",
      dirtyCount: 0,
      observedAt: null,
      ...(observation?.errorCode ? { checkStatus: "failed" as const } : {}),
    }
  const canonicalHash = hashHours(row.payload as NormalizedHours)
  if (!observation?.googleHash || !observation.observedAt) {
    const edited = row.baselineCanonicalHash
      ? canonicalHash !== row.baselineCanonicalHash
      : row.revision > 1
    return {
      status: edited ? "core_dirty" : "unknown",
      dirtyCount: edited ? 1 : 0,
      observedAt: null,
      ...(observation?.errorCode ? { checkStatus: "failed" as const } : {}),
    }
  }
  const status = classifyHoursDrift({
    canonicalHash,
    googleHash: observation.googleHash,
    baselineCanonicalHash: observation.comparisonCanonicalHash,
    baselineGoogleHash: observation.comparisonGoogleHash,
  })
  return {
    status,
    dirtyCount: status === "core_dirty" || status === "conflict" ? 1 : 0,
    observedAt: iso(observation.observedAt),
    checkStatus:
      observation.errorCode || observation.blocked ? "failed" : "checked",
  }
}

/**
 * Profile drift per field: the canonical value hashed now, Google's value as
 * last observed, and the baselines the last publish pinned — the same
 * classification the editor runs, minus the live read.
 */
export function profileArea(
  canonical: CanonicalRow | undefined,
  fields: ProfileFieldRow[]
): SyncedArea {
  if (!canonical || fields.length === 0) {
    return { status: "unknown", dirtyCount: 0, observedAt: null }
  }
  const payload = canonical.payload as NormalizedProfile
  const byKey = new Map(fields.map((field) => [field.fieldKey, field]))
  let worst: SyncStatus = "in_sync"
  let dirtyCount = 0
  let observedAt: Date | null = null
  let missingField = false
  for (const key of PROFILE_FIELD_KEYS) {
    const stored = byKey.get(key)
    if (!stored) {
      missingField = true
      continue
    }
    if (!observedAt || stored.observedAt < observedAt)
      observedAt = stored.observedAt
    const status = classifyProfileField({
      canonicalHash: hashProfileValue(payload[key] ?? null),
      googleHash: stored.googleHash,
      baselineCanonicalHash: stored.baselineCanonicalHash,
      baselineGoogleHash: stored.baselineGoogleHash,
    })
    if (status === "core_dirty" || status === "conflict") dirtyCount += 1
    worst = worse(worst, status)
  }
  return {
    status: missingField && worst === "in_sync" ? "unknown" : worst,
    dirtyCount,
    observedAt: iso(observedAt),
    ...(missingField ? { checkStatus: "unchecked" as const } : {}),
  }
}

export function menuArea(
  canonical: CanonicalRow | undefined,
  state: MenuStateRow | undefined
): SyncedArea & { eligible: boolean | null } {
  if (!state) {
    return {
      status: "unknown",
      dirtyCount: 0,
      observedAt: null,
      eligible: null,
    }
  }
  const canonicalHash = canonical
    ? hashFoodMenus(
        Array.isArray(canonical.payload)
          ? (canonical.payload as Array<Record<string, unknown>>)
          : []
      )
    : state.canonicalHash
  // The menu publish is a whole-menu replacement, so its baseline is the
  // Google hash the last observation recorded: local differs from Google
  // means not on Google yet, unless Google itself moved since the baseline.
  const comparison = state.googlePayload
    ? compareMenuReplacement({
        draft:
          canonical && Array.isArray(canonical.payload)
            ? canonical.payload
            : (state.canonicalPayload ?? []),
        google: state.googlePayload,
      })
    : null
  const localDiffers = comparison
    ? comparison.rows.length > 0
    : canonicalHash !== state.googleHash
  const googleMoved =
    canonical?.baselineGoogleHash != null &&
    state.googleHash !== canonical.baselineGoogleHash
  const status: SyncStatus = localDiffers
    ? googleMoved
      ? "conflict"
      : "core_dirty"
    : "in_sync"
  return {
    status,
    dirtyCount: comparison ? comparison.rows.length : localDiffers ? 1 : 0,
    observedAt: iso(state.observedAt),
    eligible: state.eligible,
  }
}

const SEVERITY: Record<SyncStatus, number> = {
  in_sync: 0,
  unknown: 0,
  core_dirty: 1,
  google_dirty: 2,
  conflict: 3,
}

function worse(a: SyncStatus, b: SyncStatus): SyncStatus {
  return SEVERITY[b] > SEVERITY[a] ? b : a
}

function toLastPublish(row: AttemptRow | undefined): LastPublish | null {
  if (!row) return null
  const status =
    row.status === "succeeded" ||
    row.status === "failed" ||
    row.status === "ambiguous"
      ? row.status
      : "in_progress"
  return { at: new Date(row.at).toISOString(), status, area: row.area }
}

/** Reconcile runs every 15 minutes; an hour is three missed runs. */
const FRESHNESS_WINDOW_MS = 60 * 60 * 1000

/** The listing's three-state freshness, the same rules as a client's. */
function listingFreshness(
  link: LinkRow
): NonNullable<ListingSummary["freshness"]> {
  const lastCheckedAt = link.lastCheckedAt?.toISOString() ?? null
  const broken =
    link.reconnectRequired ||
    (link.connectionStatus !== null &&
      link.connectionStatus !== "active" &&
      link.connectionStatus !== "expired")
  if (broken) {
    return {
      state: "action_needed",
      reason: "reconnect_required",
      lastCheckedAt,
    }
  }
  if (link.accessState === "access_lost") {
    return {
      state: "action_needed",
      reason: "listing_access_lost",
      lastCheckedAt,
    }
  }
  const baseline = link.lastCheckedAt ?? link.linkedAt
  if (baseline && Date.now() - baseline.getTime() > FRESHNESS_WINDOW_MS) {
    return {
      state: "data_delayed",
      reason: link.connectionErrorCode ? "google_unavailable" : "sync_delayed",
      lastCheckedAt,
    }
  }
  if (link.connectionErrorCode) {
    return {
      state: "data_delayed",
      reason: "google_unavailable",
      lastCheckedAt,
    }
  }
  return { state: "up_to_date", reason: null, lastCheckedAt }
}

/**
 * Summaries for every requested listing the session may see. Pass no ids for
 * the whole directory. Each table is read once for the whole set, so the
 * board costs the same handful of queries as one overview.
 */
export async function readListingSummaries(
  sql: TransactionSql,
  session: Session,
  locationIds?: readonly string[]
): Promise<ListingSummary[]> {
  const scope =
    locationIds && locationIds.length > 0
      ? sql`and l.id = any(${sql.array([...locationIds])}::uuid[])`
      : sql``

  const links = await sql<LinkRow[]>`
    select
      l.id::text as "locationId",
      (ll.id is not null) as linked,
      coalesce(e.verified, false) as verified,
      gc.status as "connectionStatus",
      case when gc.id is null then null else exists (
        select 1 from connection_task ct
        where ct.google_connection_id = gc.id
          and ct.task_type = 'reconnect'
          and ct.status = 'open'
      ) end as "reconnectRequired",
      gc.google_email as "googleEmail",
      gc.last_error_code as "connectionErrorCode",
      e.access_state as "accessState",
      ll.created_at as "linkedAt",
      (
        -- Successful review checks only (0047): a failed sync never makes a
        -- listing look fresh.
        select max(sc.last_succeeded_at)
        from sync_checkpoint sc
        where sc.external_location_id = e.id
          and sc.sync_type in ('reconcile', 'backfill', 'sweep', 'notification')
      ) as "lastCheckedAt"
    from location l
    left join location_link ll on ll.location_id = l.id and ll.is_active
    left join external_location e on e.id = ll.external_location_id
    left join google_connection gc on gc.id = e.google_connection_id
    where ${visibilityPredicate(sql, session, sql`l.id`)}
    ${scope}
  `
  if (links.length === 0) return []
  const ids = links.map((row) => row.locationId)
  const idList = sql.array(ids)

  const [
    canonical,
    profileFields,
    menuStates,
    observations,
    reconcileStates,
    booking,
    photos,
    posts,
    suggestions,
    attempts,
  ] = await Promise.all([
    sql<CanonicalRow[]>`
        select
          location_id::text as "locationId",
          resource_type as "resourceType",
          revision::int as revision,
          payload,
          baseline_canonical_hash as "baselineCanonicalHash",
          baseline_google_hash as "baselineGoogleHash",
          last_reconciled_at as "lastReconciledAt"
        from presence_canonical_resource
        where location_id = any(${idList}::uuid[])
      `,
    sql<ProfileFieldRow[]>`
        select
          location_id::text as "locationId",
          field_key as "fieldKey",
          google_hash as "googleHash",
          baseline_canonical_hash as "baselineCanonicalHash",
          baseline_google_hash as "baselineGoogleHash",
          observed_at as "observedAt",
          -- Field values are stored wrapped as {"value": …}.
          case when field_key = 'mapsUrl' then google_value ->> 'value' end
            as "mapsUrl"
        from profile_field_state
        where location_id = any(${idList}::uuid[])
      `,
    sql<MenuStateRow[]>`
        select
          location_id::text as "locationId",
          eligible,
          canonical_hash as "canonicalHash",
          google_hash as "googleHash",
          google_payload as "googlePayload",
          canonical_payload as "canonicalPayload",
          observed_at as "observedAt"
        from food_menus_state
        where location_id = any(${idList}::uuid[])
      `,
    sql<HoursObservation[]>`
      select location_id::text as "locationId", observed_google_hash as "googleHash",
        comparison_canonical_hash as "comparisonCanonicalHash", comparison_google_hash as "comparisonGoogleHash",
        observed_at as "observedAt", observation_attempted_at as "attemptedAt",
        case when status = 'failed' and last_error_code is distinct from 'proposal_raise_failed' and coalesce(reconciliation_started_at, last_attempt_at) > coalesce(observation_attempted_at, '-infinity'::timestamptz)
          then coalesce(last_error_code, 'hours_check_failed') else observation_error_code end as "errorCode", comparison_blocked as blocked
      from presence_resource_reconcile_state where location_id = any(${idList}::uuid[]) and resource = 'hours'
    `,
    sql<
      {
        locationId: string
        resource: string
        status: string
        lastAttemptAt: Date
        observationAttemptedAt: Date | null
        observationErrorCode: string | null
        reconciliationStartedAt: Date | null
        lastErrorCode: string | null
      }[]
    >`
      select location_id::text as "locationId", resource, status, last_attempt_at as "lastAttemptAt", observation_attempted_at as "observationAttemptedAt", observation_error_code as "observationErrorCode", reconciliation_started_at as "reconciliationStartedAt", last_error_code as "lastErrorCode"
      from presence_resource_reconcile_state where location_id = any(${idList}::uuid[]) and resource in ('profile', 'foodMenus')
    `,
    sql<CountRow[]>`
        select location_id::text as "locationId", count(*)::int as count
        from place_action_link
        where location_id = any(${idList}::uuid[]) and deleted_at is null
        group by location_id
      `,
    sql<CountRow[]>`
        select location_id::text as "locationId", count(*)::int as count
        from gbp_media_item
        where location_id = any(${idList}::uuid[])
          and deleted_at is null and ownership = 'merchant'
        group by location_id
      `,
    sql<PostCountRow[]>`
        select location_id::text as "locationId", status, count(*)::int as count
        from gbp_local_post
        where location_id = any(${idList}::uuid[]) and status <> 'deleted'
        group by location_id, status
      `,
    sql<SuggestionRow[]>`
        select location_id::text as "locationId", resource_type as "resourceType", count(*)::int as count
        from presence_import_proposal
        where location_id = any(${idList}::uuid[]) and status = 'pending'
        group by location_id, resource_type
      `,
    // The newest attempt per listing across every area that publishes.
    sql<AttemptRow[]>`
        select distinct on (location_id)
          location_id::text as "locationId", area, status, at
        from (
          select location_id, 'profile' as area, status, created_at as at
            from profile_sync_attempt where direction = 'to_google'
          union all
          select location_id, 'hours', status, created_at from hours_sync_attempt
          union all
          select location_id, 'menu', status, created_at from food_menus_sync_attempt
          union all
          select location_id, 'photos', status, created_at from gbp_media_mutation
          union all
          select location_id, 'booking', status, created_at from place_action_mutation
          union all
          select p.location_id, 'posts', a.status, a.created_at
            from gbp_local_post_attempt a
            join gbp_local_post p on p.id = a.post_id
          union all
          select location_id, 'listing', status, created_at from gbp_management_mutation
            where location_id is not null
        ) attempts
        where location_id = any(${idList}::uuid[])
        order by location_id, at desc
      `,
  ])

  const canonicalBy = new Map<string, CanonicalRow>()
  for (const row of canonical)
    canonicalBy.set(`${row.locationId}:${row.resourceType}`, row)
  const fieldsBy = new Map<string, ProfileFieldRow[]>()
  for (const row of profileFields) {
    const list = fieldsBy.get(row.locationId) ?? []
    list.push(row)
    fieldsBy.set(row.locationId, list)
  }
  const observationsBy = new Map(
    observations.map((row) => [row.locationId, row])
  )
  const reconcileBy = new Map(
    reconcileStates.map((row) => [`${row.locationId}:${row.resource}`, row])
  )
  const menuBy = new Map(menuStates.map((row) => [row.locationId, row]))
  const bookingBy = new Map(booking.map((row) => [row.locationId, row.count]))
  const photosBy = new Map(photos.map((row) => [row.locationId, row.count]))
  const attemptBy = new Map(attempts.map((row) => [row.locationId, row]))
  const postsBy = new Map<string, Record<string, number>>()
  for (const row of posts) {
    const counts = postsBy.get(row.locationId) ?? {}
    counts[row.status] = row.count
    postsBy.set(row.locationId, counts)
  }
  const suggestionsBy = new Map<string, Record<string, number>>()
  for (const row of suggestions) {
    const counts = suggestionsBy.get(row.locationId) ?? {}
    counts[row.resourceType] = row.count
    suggestionsBy.set(row.locationId, counts)
  }

  return links.map((link) => {
    const base = emptyListingSummary({
      locationId: link.locationId,
      linked: link.linked,
      verified: link.verified,
    })
    const postCounts = postsBy.get(link.locationId) ?? {}
    const suggestionCounts = suggestionsBy.get(link.locationId) ?? {}
    const menuCanonical = canonicalBy.get(`${link.locationId}:food_menus`)
    function withCheck<T extends SyncedArea>(area: T, resource: string): T {
      const check = reconcileBy.get(`${link.locationId}:${resource}`)
      if (
        check?.observationErrorCode ||
        (check?.status === "failed" &&
          check.lastErrorCode !== "proposal_raise_failed" &&
          (check.reconciliationStartedAt ?? check.lastAttemptAt).getTime() >
            (check.observationAttemptedAt?.getTime() ??
              (area.observedAt ? Date.parse(area.observedAt) : 0)))
      )
        return { ...area, checkStatus: "failed" }
      return area
    }
    const profile = withCheck(
      profileArea(
        canonicalBy.get(`${link.locationId}:profile`),
        fieldsBy.get(link.locationId) ?? []
      ),
      "profile"
    )
    const menu = withCheck(
      menuArea(menuCanonical, menuBy.get(link.locationId)),
      "foodMenus"
    )
    return {
      ...base,
      freshness: link.linked ? listingFreshness(link) : undefined,
      connection: link.connectionStatus
        ? {
            status: link.connectionStatus,
            reconnectRequired: link.reconnectRequired ?? false,
            googleEmail: link.googleEmail,
          }
        : null,
      profile,
      hours: hoursArea(
        canonicalBy.get(`${link.locationId}:hours`),
        observationsBy.get(link.locationId)
      ),
      menu: {
        ...menu,
        eligible: menu.checkStatus === "failed" ? null : menu.eligible,
      },
      booking: {
        count: bookingBy.get(link.locationId) ?? 0,
        observedAt: null,
      },
      photos: { count: photosBy.get(link.locationId) ?? 0, observedAt: null },
      posts: {
        drafts: postCounts.draft ?? 0,
        awaitingApproval: postCounts.awaiting_approval ?? 0,
        failed: postCounts.failed ?? 0,
        published: postCounts.published ?? 0,
      },
      suggestions: {
        profile: suggestionCounts.profile ?? 0,
        foodMenus: suggestionCounts.food_menus ?? 0,
      },
      lastPublish: toLastPublish(attemptBy.get(link.locationId)),
      mapsUrl: googleMapsUrl(
        (fieldsBy.get(link.locationId) ?? []).find(
          (row) => row.fieldKey === "mapsUrl"
        )?.mapsUrl
      ),
    }
  })
}

/**
 * The listing's public Maps link as Google last reported it, only when it
 * is an https link on a Google host (it becomes an href in the UI).
 */
function googleMapsUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    const host = url.hostname
    const google =
      /(^|\.)google\.[a-z.]+$/.test(host) ||
      host === "maps.app.goo.gl" ||
      host === "goo.gl"
    return url.protocol === "https:" && google ? url.toString() : null
  } catch {
    return null
  }
}
