import "server-only"

import type { Fragment, TransactionSql } from "postgres"

import type { LocationScope } from "@/lib/contracts/members"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
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
//   client         -> visible when at least one of its locations is. This
//                     COMPOSES the rule above rather than adding a second
//                     one; there is deliberately no client_member table,
//                     because two membership tables can disagree and this
//                     module exists so that cannot happen.
//   client share   -> not a member at all: the holder of a client report
//                     link (lib/server/shared-report.ts). Sees the locations
//                     filed under that ONE client and nothing else, whatever
//                     role or location_member rows exist. It carries no role,
//                     so it can never reach grantsFor / canPublishLocation:
//                     it reads, it never edits or publishes.
//
// Client access is location_member rows too
//   Team edits access a client at a time (PUT /api/members/[userId]/
//   client-access), and a scoped invitation grants clients on acceptance.
//   Both EXPAND a client into one row per listing filed under it, in
//   lib/server/client-access.ts; the rule above still reads only rows.
//   Three consequences follow from "no rows = every location":
//   * Zero rows is a widening, never a removal. Every writer refuses a
//     change that would leave a member or viewer with no rows unless the
//     caller says `allClients: true` (the client-access route), and a scoped invitation whose clients have no listings left
//     is refused at acceptance rather than accepted unscoped.
//   * A listing filed under a client later reaches only the people who hold
//     EVERY other listing of that client (extendClientHolders, called by
//     POST /api/clients/[id]/locations, POST /api/location-links and the
//     automatic Google setup; each extension is audited as
//     member.client_access_extended). Someone holding part of a client, and
//     anyone holding "Unfiled listings", is not extended.
//   * Deleting a listing cascades its rows away; a member whose only rows
//     go with it is back to every location. No route deletes listings today.
//
// Explicit scope, shadowed (supabase 0063)
//   member.location_scope ('all' | 'assigned') is now written with the rows
//   by every writer, but NOTHING here reads it to decide a grant yet. When
//   SCOPE_SHADOW_COMPARE is on, grantsFor also fetches it and logs
//   permissions.scope_shadow_mismatch for any location where the explicit
//   rule ('all' -> every location; 'assigned' -> exactly the rows, none when
//   there are none) would answer differently. Readers switch only once that
//   log stays quiet.
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
//   * Gating a mutation (404 when hidden, 403 when the role/grant may not):
//       await requireLocationAction(sql, session, locationId, "edit")
//     The action vocabulary and its rule are LOCATION_ACTIONS/actionAllowed.
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

/** A signed-in member, as far as visibility is concerned. */
export type MemberVisibility = Pick<Session, "role" | "userId">

/**
 * The holder of a client report share link. No user, no role: visibility is
 * exactly the one client's locations. Only lib/server/shared-report.ts builds
 * one, from a token lookup_report_share() resolved.
 */
export type ClientShareVisibility = {
  kind: "client_share"
  clientId: string
}

export type VisibilityScope = MemberVisibility | ClientShareVisibility

/**
 * Who a report is read for: a member's session, or a client share. The
 * reporting loaders (lib/server/analytics-overview.ts,
 * lib/server/presence-report.ts) take this rather than a whole Session, so
 * the public shared report runs the very same SQL as Reports.
 */
export type ReportViewer = VisibilityScope & { organisationId: string }
export type GrantScope = Pick<Session, "role" | "userId" | "canPublish">

export function isManagerialRole(role: Session["role"]) {
  return role === "owner" || role === "admin"
}

export function isClientShareScope(
  scope: VisibilityScope
): scope is ClientShareVisibility {
  return "kind" in scope && scope.kind === "client_share"
}

/**
 * The share scope's client id, refusing an empty one. A share scope with no
 * client would otherwise be a predicate over nothing -- and the loaders it is
 * handed to treat "no client" as "the whole agency".
 */
function shareClientId(scope: ClientShareVisibility): string {
  if (typeof scope.clientId !== "string" || scope.clientId.length === 0) {
    throw new Error("A client share scope needs its client id.")
  }
  return scope.clientId
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
  if (isClientShareScope(session)) {
    return sql`exists (
      select 1 from location visibility_share_l
      where visibility_share_l.id = ${locationColumn}
        and visibility_share_l.client_id = ${shareClientId(session)}
    )`
  }
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

  type ScopeRow = {
    hasAssignments: boolean
    grants: Record<string, boolean> | null
    locationScope?: LocationScope | null
  }
  // Two whole statements rather than an optional fragment: the shadowed one
  // is today's query plus one column, so the grant it answers is identical.
  const shadow = scopeShadowCompareEnabled()
  const [scope] = shadow
    ? await sql<ScopeRow[]>`
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
          ) as grants,
          (
            select m.location_scope from member m
            where m.user_id = ${session.userId}
          ) as "locationScope"
      `
    : await sql<ScopeRow[]>`
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
  if (shadow && scope?.locationScope) {
    const mismatched = scopeShadowMismatches({
      role: session.role,
      sessionCanPublish: session.canPublish,
      locationScope: scope.locationScope,
      assignedPublish,
      current: result,
    })
    if (mismatched.length > 0) {
      log.warn("permissions.scope_shadow_mismatch", {
        userId: session.userId,
        role: session.role,
        locationScope: scope.locationScope,
        hasAssignments,
        mismatched: mismatched.length,
        sample: mismatched.slice(0, 5),
      })
    }
  }
  return result
}

/**
 * Whether grantsFor shadows the explicit scope. Diagnostic only, so a
 * server env that cannot be read (a unit test without one) means off; the
 * deployed app has already validated its env at startup.
 */
function scopeShadowCompareEnabled(): boolean {
  try {
    return getServerEnv().SCOPE_SHADOW_COMPARE === true
  } catch {
    return false
  }
}

/**
 * The ids in `current` (today's row-inferred grants for a member or viewer)
 * where the explicit-scope rule would grant differently, in `visible` or
 * `canPublish`. Pure: the explicit rule is
 *
 *   'all'      -> visible everywhere; publish is the organisation-level
 *                 member.can_publish (the session fallback);
 *   'assigned' -> visible exactly where a row exists, publish from that row,
 *                 and nothing at all when there are no rows.
 *
 * Viewers never publish under either rule. Owners and admins never reach
 * here: both rules give them every location.
 */
export function scopeShadowMismatches(input: {
  role: Session["role"]
  sessionCanPublish: boolean
  locationScope: LocationScope
  /** Lower-cased location id -> the row's can_publish, for rows that exist. */
  assignedPublish: ReadonlyMap<string, boolean>
  current: ReadonlyMap<string, LocationGrant>
}): string[] {
  const mismatched: string[] = []
  for (const [id, grant] of input.current) {
    const key = id.toLowerCase()
    const visible =
      input.locationScope === "all" ? true : input.assignedPublish.has(key)
    const canPublish =
      !visible || input.role === "viewer"
        ? false
        : input.locationScope === "all"
          ? input.sessionCanPublish
          : (input.assignedPublish.get(key) ?? false)
    if (visible !== grant.visible || canPublish !== grant.canPublish) {
      mismatched.push(id)
    }
  }
  return mismatched
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

/**
 * What a member may do at one location. Every mutation entry point names
 * the action it performs and asks `requireLocationAction`; route visibility
 * (requireLocationAccess) never authorises a write on its own.
 *
 *   read             -> visible
 *   edit             -> canEdit   (create/update/delete drafts; never a viewer)
 *   request_approval -> canEdit   (submit a reply or post for approval)
 *   triage           -> canEdit   (mark a review as needing nothing)
 *   assign           -> canEdit   (set or clear a review's assignee)
 *   decide_approval  -> canPublish (approve or reject someone's request)
 *   publish          -> canPublish (send to Google)
 *
 * A viewer is read-only everywhere, whatever grant rows say.
 */
export const LOCATION_ACTIONS = [
  "read",
  "edit",
  "request_approval",
  "triage",
  "assign",
  "decide_approval",
  "publish",
] as const
export type LocationAction = (typeof LOCATION_ACTIONS)[number]

/** Pure rule: may `role` holding `grant` perform `action`? */
export function actionAllowed(
  role: Session["role"],
  grant: LocationGrant,
  action: LocationAction
): boolean {
  if (!grant.visible) return false
  if (action === "read") return true
  if (role === "viewer") return false
  switch (action) {
    case "edit":
    case "request_approval":
    case "triage":
    case "assign":
      return grant.canEdit
    case "decide_approval":
    case "publish":
      return grant.canPublish
  }
}

/**
 * Gate one action at one location. A hidden location answers 404 exactly as
 * `requireLocationAccess` does (same default code, so a probe cannot tell
 * "not yours" from "does not exist"); a visible location the scope may not
 * act on answers 403 `permission_denied`.
 */
export async function requireLocationAction(
  sql: TransactionSql,
  scope: GrantScope,
  locationId: string,
  action: LocationAction,
  notFound: LocationNotFound = {}
): Promise<LocationGrant> {
  const grant = await grantFor(sql, scope, locationId)
  if (!grant.visible) {
    throw new ApiError(
      404,
      notFound.code ?? "review_not_found",
      notFound.message ?? "The requested review was not found."
    )
  }
  if (!actionAllowed(scope.role, grant, action)) {
    throw new ApiError(
      403,
      "permission_denied",
      "You do not have permission to do that for this location."
    )
  }
  return grant
}

/**
 * SQL fragment that is true when the session may see the client whose id is
 * `clientColumn` (e.g. sql`c.id`). Owner/admin: `true`.
 *
 * Built on `visibilityPredicate`, so a change to location visibility carries
 * into client visibility automatically. A client with NO locations is visible
 * to owners and admins only — which is right: an empty client is a setup
 * artefact, and a member with no locations in it has nothing to do there.
 */
export function clientVisibilityPredicate(
  sql: TransactionSql,
  session: VisibilityScope,
  clientColumn: Fragment
): Fragment {
  if (isClientShareScope(session)) {
    return sql`(${clientColumn} = ${shareClientId(session)})`
  }
  if (isManagerialRole(session.role)) return sql`true`
  return sql`exists (
    select 1 from location visibility_cl
    where visibility_cl.client_id = ${clientColumn}
      and ${visibilityPredicate(sql, session, sql`visibility_cl.id`)}
  )`
}

/**
 * Throws 404 when the client does not exist or is hidden from the session.
 *
 * Same 404 for both, deliberately: a member who probes client ids must not be
 * able to tell "no such client" from "not yours".
 */
export async function requireClientAccess(
  sql: TransactionSql,
  session: VisibilityScope,
  clientId: string
) {
  const [row] = await sql<{ visible: boolean }[]>`
    select ${clientVisibilityPredicate(sql, session, sql`c.id`)} as visible
    from client c
    where c.id = ${clientId}
  `
  if (!row?.visible) {
    throw new ApiError(
      404,
      "client_not_found",
      "The requested client was not found."
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
