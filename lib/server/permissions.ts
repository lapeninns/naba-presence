import "server-only"

import type { Fragment, TransactionSql } from "postgres"

import type { LocationScope } from "@/lib/contracts/members"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

// Location visibility and publish grants: THE ONLY implementation.
//
// "Which locations can this member see / publish to" is decided here and
// nowhere else. Do not re-implement the rule inline (no `exists (select 1
// from location_member ...)` in route files, capabilities, or query
// builders) -- compose one of the exports below instead.
//
// The rule (member.location_scope, supabase 0082/0083)
//   owner / admin  -> every location is visible, editable and publishable.
//   viewer, member -> scope 'all': every location in the organisation.
//                     scope 'assigned': exactly the location_member rows,
//                     and NOTHING when there are none.
//   canEdit        -> visible and role is not "viewer".
//   canPublish     -> owner/admin: true. viewer: false. member: 'all' uses
//                     the organisation-level member.can_publish (carried as
//                     session.canPublish); 'assigned' uses the row's
//                     can_publish.
//   no membership  -> nothing (no member row in this organisation reads as
//                     neither 'all' nor any row).
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
// Absence never means "all"
//   Before 0082 a member or viewer with no rows saw every location, so
//   deleting someone's last listing widened them to everything. The scope is
//   now named, and there is no fallback to that rule anywhere: zero rows on
//   'assigned' is no access. The database keeps "a member or viewer holding
//   a row is 'assigned'" (0083 triggers), so 'all' plus rows only happens for
//   owners and admins, whose rows are latent; if it ever did happen to a
//   member, 'all' wins and the rows are ignored.
//
// Client access is location_member rows too
//   Team edits access a client at a time (PUT /api/members/[userId]/
//   client-access), and a scoped invitation grants clients on acceptance.
//   Both EXPAND a client into one row per listing filed under it, in
//   lib/server/client-access.ts, and set the scope in the same transaction.
//   * "Every client" is asked for by name (`allClients: true`) and saved as
//     scope 'all'; choosing no clients is saved as 'assigned' with no rows,
//     which is no access, not every client.
//   * A listing filed under a client later reaches only the 'assigned'
//     people who hold EVERY other listing of that client
//     (extendClientHolders, called by POST /api/clients/[id]/locations,
//     POST /api/location-links and the automatic Google setup; each
//     extension is audited as member.client_access_extended). Someone holding
//     part of a client, and anyone holding "Unfiled listings", is not
//     extended.
//   * Deleting a listing cascades its rows away; a member whose only rows go
//     with it sees nothing until an owner grants them more.
//
// Membership is read inside the tenant transaction; RLS on member and
// location_member scopes both to the session's organisation, as for every
// other read here. The member lookups also filter on app.organisation_id
// themselves, because a scope read from the wrong organisation could WIDEN
// access (a location_member row from elsewhere can only fail to match).
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
    ${scopeIsAll(sql, session.userId)}
    or exists (
      select 1 from location_member visibility_lm
      where visibility_lm.user_id = ${session.userId}
        and visibility_lm.location_id = ${locationColumn}
    )
  )`
}

/**
 * True when the user's membership of the tenant's organisation is scope
 * 'all'. No membership is false: absence never widens.
 *
 * Both member lookups here (this one and grantsFor's) filter on the tenant
 * transaction's app.organisation_id rather than leaning on RLS alone: a user
 * can be 'all' in one organisation and 'assigned' in another, and on a
 * connection that bypasses RLS an unfiltered read would let the first widen
 * the second. Outside a tenant transaction the setting is empty, the
 * comparison is null and no membership matches, so the read fails closed.
 */
function scopeIsAll(sql: TransactionSql, userId: string): Fragment {
  return sql`exists (
    select 1 from member visibility_m
    where visibility_m.user_id = ${userId}
      and visibility_m.organisation_id =
        nullif(current_setting('app.organisation_id', true), '')::uuid
      and visibility_m.location_scope = 'all'
  )`
}

/**
 * SQL fragment that is true when the scope may publish to the row whose
 * location id is `locationColumn`: the canPublish half of `grantsFor`, for
 * queries that decide it per row in one statement (review queues). It
 * implies visibility.
 */
export function publishPredicate(
  sql: TransactionSql,
  scope: GrantScope,
  locationColumn: Fragment
): Fragment {
  if (isManagerialRole(scope.role)) return sql`true`
  if (scope.role === "viewer") return sql`false`
  return sql`(
    case
      when ${scopeIsAll(sql, scope.userId)} then ${scope.canPublish}
      else coalesce(
        (
          select publish_lm.can_publish
          from location_member publish_lm
          where publish_lm.user_id = ${scope.userId}
            and publish_lm.location_id = ${locationColumn}
        ),
        false
      )
    end
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
    locationScope: LocationScope | null
    grants: Record<string, boolean> | null
  }
  const [scope] = await sql<ScopeRow[]>`
    select
      (
        select m.location_scope from member m
        where m.user_id = ${session.userId}
          and m.organisation_id =
            nullif(current_setting('app.organisation_id', true), '')::uuid
      ) as "locationScope",
      (
        select json_object_agg(lm.location_id::text, lm.can_publish)
        from location_member lm
        where lm.user_id = ${session.userId}
          and lm.location_id in ${sql(unique)}
      ) as grants
  `
  // Postgres renders uuid keys lower-case; the caller's ids arrive as typed
  // (z.uuid() accepts upper-case hex), so compare case-insensitively — the
  // SQL `uuid = uuid` this replaced never cared about casing.
  const assignedPublish = new Map(
    Object.entries(scope?.grants ?? {}).map(([id, publish]) => [
      id.toLowerCase(),
      publish,
    ])
  )
  for (const id of unique) {
    result.set(
      id,
      memberGrant({
        role: session.role,
        sessionCanPublish: session.canPublish,
        locationScope: scope?.locationScope ?? null,
        assignedPublish: assignedPublish.has(id.toLowerCase())
          ? (assignedPublish.get(id.toLowerCase()) ?? false)
          : null,
      })
    )
  }
  return result
}

/**
 * The rule for one location, for a member or viewer. Pure:
 *
 *   no membership -> nothing;
 *   'all'         -> visible; publish is the organisation-level
 *                    member.can_publish (the session's canPublish);
 *   'assigned'    -> visible exactly where a row exists, publish from that
 *                    row; no row is no access, never a fallback to 'all'.
 *
 * Viewers never edit or publish.
 */
export function memberGrant(input: {
  role: Session["role"]
  sessionCanPublish: boolean
  locationScope: LocationScope | null
  /** The row's can_publish, or null when the user holds no row here. */
  assignedPublish: boolean | null
}): LocationGrant {
  if (isManagerialRole(input.role)) return { ...FULL_GRANT }
  const visible =
    input.locationScope === "all"
      ? true
      : input.locationScope === "assigned"
        ? input.assignedPublish !== null
        : false
  if (!visible) return { ...NO_GRANT }
  const viewer = input.role === "viewer"
  const canPublish = viewer
    ? false
    : input.locationScope === "all"
      ? input.sessionCanPublish
      : input.assignedPublish === true
  return { visible, canEdit: !viewer, canPublish }
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
