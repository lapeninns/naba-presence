import "server-only"

import type { TransactionSql } from "postgres"

import {
  actionAllowed,
  grantsFor,
  NO_GRANT,
  requireLocationAction,
  type GrantScope,
  type LocationAction,
  type LocationGrant,
} from "@/lib/server/permissions"

export { requireLocationAction }
export type { GrantScope, LocationAction, LocationGrant }

// Session-free authorisation for work that runs after the request that
// asked for it: retries, scheduled publishes, recovery, bulk batches and
// deletion workers. Each of them knows only who queued the work, so each
// re-derives that person's grant from membership AT DISPATCH TIME through
// this module, never from a stored role or a stored grant. The location
// rule itself stays in lib/server/permissions.ts; this file only turns a
// membership row into the same GrantScope a Session would be.
//
// Every helper expects the tenant transaction from withTenant(organisationId).

/**
 * The GrantScope a member of `organisationId` holds right now, or null when
 * the user is no longer a member (removed, or the organisation is gone). A
 * caller must treat null as "refuse", never as "skip the check".
 */
export async function actorScopeFromMembership(
  sql: TransactionSql,
  organisationId: string,
  userId: string
): Promise<GrantScope | null> {
  const [row] = await sql<{ role: GrantScope["role"]; canPublish: boolean }[]>`
    select role, can_publish as "canPublish"
    from member
    where organisation_id = ${organisationId}
      and user_id = ${userId}
  `
  if (!row) return null
  return { userId, role: row.role, canPublish: row.canPublish }
}

export type AuthorisationRecheck = {
  organisationId: string
  /** Who queued the work. */
  actorUserId: string
  locationId: string
  action: LocationAction
  /**
   * The Google connection the work was prepared against. When given, it must
   * still back the location's active link: a relink to another connection
   * means someone else's Google identity would perform the write.
   */
  connectionId?: string | null
  /**
   * The actor's security version when the work was queued. Reserved for the
   * security-version mechanism (P02-S9); until it exists a supplied value
   * cannot be verified, so the recheck refuses rather than ignoring it.
   */
  securityVersion?: number | null
}

export type RecheckRefusal =
  | "actor_not_member"
  | "location_hidden"
  | "action_denied"
  | "connection_changed"
  | "security_version_unverifiable"

export type RecheckResult =
  | { ok: true; scope: GrantScope; grant: LocationGrant }
  | { ok: false; reason: RecheckRefusal }

/**
 * Re-decide, immediately before dispatch, whether the actor may still
 * perform `action` at `locationId`. Returns a refusal reason instead of
 * throwing so a worker can settle its own row (failed / cancelled) with a
 * truthful cause. Fail-closed: anything it cannot prove is a refusal.
 */
export async function recheckAuthorisation(
  sql: TransactionSql,
  input: AuthorisationRecheck
): Promise<RecheckResult> {
  if (input.securityVersion !== undefined && input.securityVersion !== null) {
    return { ok: false, reason: "security_version_unverifiable" }
  }
  const scope = await actorScopeFromMembership(
    sql,
    input.organisationId,
    input.actorUserId
  )
  if (!scope) return { ok: false, reason: "actor_not_member" }

  const grants = await grantsFor(sql, scope, [input.locationId])
  const grant = grants.get(input.locationId) ?? NO_GRANT
  if (!grant.visible) return { ok: false, reason: "location_hidden" }
  if (!actionAllowed(scope.role, grant, input.action)) {
    return { ok: false, reason: "action_denied" }
  }

  if (input.connectionId !== undefined && input.connectionId !== null) {
    const [link] = await sql<{ connectionId: string | null }[]>`
      select e.google_connection_id::text as "connectionId"
      from location_link ll
      join external_location e on e.id = ll.external_location_id
      where ll.location_id = ${input.locationId}
        and ll.is_active = true
      limit 1
    `
    if (
      !link?.connectionId ||
      link.connectionId.toLowerCase() !== input.connectionId.toLowerCase()
    ) {
      return { ok: false, reason: "connection_changed" }
    }
  }

  return { ok: true, scope, grant }
}
