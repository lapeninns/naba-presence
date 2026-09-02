import "server-only"

import type { Fragment, TransactionSql } from "postgres"

import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

// Location visibility and publish grants: THE ONLY implementation.
//
// "Which locations can this member see / publish to" is decided here and
// nowhere else. Do not re-implement the rule inline (no `exists (select 1
// from location_member ...)` in route files, capabilities, or query
// builders) -- compose one of the exports below instead.
//
// The rule
//   owner / admin  -> every location is visible, editable and publishable.
//   viewer, member -> if the user has NO location_member rows at all, every
//                     location in the organisation is visible; otherwise
//                     only the assigned locations are.
//   canEdit        -> visible and role is not "viewer".
//   canPublish     -> owner/admin: true. viewer: false. member: the
//                     assigned row's can_publish when the user has
//                     assignments, else the organisation-level
//                     session.canPublish fallback.
//
// How routes use it
//   * Filtering a SELECT by what the session may see:
//       where ... and ${visibilityPredicate(sql, session, sql`r.location_id`)}
//     The fragment is `true` for owner/admin, so it can be appended
//     unconditionally.
//   * Gating a single location (throws 404 when hidden):
//       await requireLocationAccess(sql, session, locationId)
//     The default 404 is the legacy `review_not_found`; callers whose
//     subject is not a review pass their own code/message:
//       await requireLocationAccess(sql, session, locationId,
//         { code: "location_not_found", message: "..." })
//     (lib/server/gbp-write.ts `loadLinkedLocation` does this so a hidden
//     location reads exactly like a nonexistent one.)
//   * Asking whether the session may publish to one location:
//       await canPublishLocation(sql, session, locationId)
//   * Many locations at once (one query), e.g. for capability payloads:
//       const grants = await grantsFor(sql, session, locationIds)
//       grants.get(id) -> { visible, canEdit, canPublish }
//
// All helpers expect the tenant transaction from withTenant(), so RLS on
// location_member already scopes rows to the session's organisation.

export type LocationGrant = {
  /** The session may read rows for this location (requireLocationAccess passes). */
  visible: boolean
  /** The session may create or edit drafts for this location. */
  canEdit: boolean
  /** The session may publish to Google for this location. */
  canPublish: boolean
}

export const FULL_GRANT: Readonly<LocationGrant> = Object.freeze({
  visible: true,
  canEdit: true,
  canPublish: true,
})

export const NO_GRANT: Readonly<LocationGrant> = Object.freeze({
  visible: false,
  canEdit: false,
  canPublish: false,
})

export type VisibilityScope = Pick<Session, "role" | "userId">
export type GrantScope = Pick<Session, "role" | "userId" | "canPublish">

export function isManagerialRole(role: Session["role"]) {
  return role === "owner" || role === "admin"
}

/**
 * SQL fragment that is true when the session may see the row whose location
 * id is `locationColumn` (e.g. sql`r.location_id`). Owner/admin: `true`.
 */
export function visibilityPredicate(
  sql: TransactionSql,
  session: VisibilityScope,
  locationColumn: Fragment
): Fragment {
  if (isManagerialRole(session.role)) return sql`true`
  return sql`(
    not exists (
      select 1 from location_member visibility_lm
      where visibility_lm.user_id = ${session.userId}
    )
    or exists (
      select 1 from location_member visibility_lm
      where visibility_lm.user_id = ${session.userId}
        and visibility_lm.location_id = ${locationColumn}
    )
  )`
}

/**
 * Batch grant reader: one query for every requested location. The returned
 * map has an entry for every distinct id in `locationIds`.
 */
export async function grantsFor(
  sql: TransactionSql,
  session: GrantScope,
  locationIds: readonly string[]
): Promise<Map<string, LocationGrant>> {
  const unique = [...new Set(locationIds)]
  const result = new Map<string, LocationGrant>()
  if (unique.length === 0) return result

  if (isManagerialRole(session.role)) {
    for (const id of unique) result.set(id, { ...FULL_GRANT })
    return result
  }

  const [scope] = await sql<
    { hasAssignments: boolean; grants: Record<string, boolean> | null }[]
  >`
    select
      exists (
        select 1 from location_member
        where user_id = ${session.userId}
      ) as "hasAssignments",
      (
        select json_object_agg(lm.location_id::text, lm.can_publish)
        from location_member lm
        where lm.user_id = ${session.userId}
          and lm.location_id in ${sql(unique)}
      ) as grants
  `
  const hasAssignments = scope?.hasAssignments ?? false
  // Postgres renders uuid keys lower-case; the caller's ids arrive as typed
  // (z.uuid() accepts upper-case hex), so compare case-insensitively — the
  // SQL `uuid = uuid` this replaced never cared about casing.
  const assignedPublish = new Map(
    Object.entries(scope?.grants ?? {}).map(([id, publish]) => [
      id.toLowerCase(),
      publish,
    ])
  )
  const viewer = session.role === "viewer"

  for (const id of unique) {
    const key = id.toLowerCase()
    const visible = hasAssignments ? assignedPublish.has(key) : true
    const canEdit = visible && !viewer
    const canPublish = viewer
      ? false
      : hasAssignments
        ? (assignedPublish.get(key) ?? false)
        : session.canPublish
    result.set(id, { visible, canEdit, canPublish })
  }
  return result
}

async function grantFor(
  sql: TransactionSql,
  session: GrantScope,
  locationId: string
): Promise<LocationGrant> {
  const grants = await grantsFor(sql, session, [locationId])
  return grants.get(locationId) ?? NO_GRANT
}

/** The 404 raised by `requireLocationAccess` when the location is hidden. */
export type LocationNotFound = { code?: string; message?: string }

export async function requireLocationAccess(
  sql: TransactionSql,
  session: GrantScope,
  locationId: string,
  notFound: LocationNotFound = {}
) {
  const grant = await grantFor(sql, session, locationId)
  if (!grant.visible) {
    throw new ApiError(
      404,
      notFound.code ?? "review_not_found",
      notFound.message ?? "The requested review was not found."
    )
  }
}

export async function canPublishLocation(
  sql: TransactionSql,
  session: GrantScope,
  locationId: string
) {
  const grant = await grantFor(sql, session, locationId)
  return grant.canPublish
}
