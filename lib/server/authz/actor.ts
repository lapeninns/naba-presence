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
   * The actor's security version when the work was queued (the session's
   * `securityVersion`, 0105). When given, app_user.security_version must
   * still equal it: operator MFA recovery (scripts/mfa-recover.mjs) bumps the
   * version, and work a recovered account queued before that must not
   * dispatch. Omit it only for work queued before versions were recorded.
   */
  securityVersion?: number | null
  /**
   * The organisation's approval policy when the work was queued. When given,
   * it must still hold: work queued under "no approval needed" must not
   * dispatch after an owner turned approval (or two-person approval) on.
   */
  policy?: ApprovalPolicy | null
  /**
   * The Google credential generation the work was queued under, as the
   * operation ledger records it (mutation_operation.connection_generation,
   * from google_connection.credential_generation). When given, the
   * location's active connection must still hold that generation: a
   * reconnect or disconnect since means the credential the actor's intent was
   * prepared against is gone, so the work must not dispatch on its successor.
   *
   * The generation is a per-connection counter (every connection starts at
   * 1), so it means something only together with `connectionId`: a relink to
   * another connection at the same number would otherwise pass. A generation
   * without a connection id is refused as `connection_changed`.
   */
  generation?: number | null
  /**
   * Deliberately unused: any value is refused as `entitlement_unverifiable`
   * rather than ignored. Billing entitlement is not this recheck's to decide.
   * Each worker checks it itself, in the same tenant transaction, through
   * organisationWriteBlock (lib/server/entitlement-policy.ts, deriveAccess):
   * the publish retry (lib/server/jobs.ts), the bulk runner
   * (lib/server/bulk-listing-runner.ts) and the scheduled post runner
   * (lib/server/publication-schedule-runner.ts), each with its own hold.
   * A caller that passes this expecting it to be checked fails closed.
   */
  entitlement?: string | null
}

export type ApprovalPolicy = {
  approvalRequired: boolean
  requireTwoPersonApproval: boolean
}

export type RecheckRefusal =
  | "actor_not_member"
  | "location_hidden"
  | "action_denied"
  | "connection_changed"
  | "security_version_changed"
  | "policy_changed"
  | "generation_changed"
  | "entitlement_unverifiable"

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
  if (input.entitlement !== undefined && input.entitlement !== null) {
    return { ok: false, reason: "entitlement_unverifiable" }
  }
  const scope = await actorScopeFromMembership(
    sql,
    input.organisationId,
    input.actorUserId
  )
  if (!scope) return { ok: false, reason: "actor_not_member" }

  if (input.securityVersion !== undefined && input.securityVersion !== null) {
    // app_user is visible here: the actor is a member of this tenant, which
    // is what app_user's policy admits (0001, 0040).
    const [user] = await sql<{ securityVersion: number }[]>`
      select security_version as "securityVersion"
      from app_user
      where id = ${input.actorUserId}
    `
    if (!user || user.securityVersion !== input.securityVersion) {
      return { ok: false, reason: "security_version_changed" }
    }
  }

  const grants = await grantsFor(sql, scope, [input.locationId])
  const grant = grants.get(input.locationId) ?? NO_GRANT
  if (!grant.visible) return { ok: false, reason: "location_hidden" }
  if (!actionAllowed(scope.role, grant, input.action)) {
    return { ok: false, reason: "action_denied" }
  }

  const checkConnection =
    input.connectionId !== undefined && input.connectionId !== null
  const checkGeneration =
    input.generation !== undefined && input.generation !== null
  if (checkGeneration && !checkConnection) {
    return { ok: false, reason: "connection_changed" }
  }
  if (checkConnection) {
    const [link] = await sql<
      { connectionId: string | null; generation: number | null }[]
    >`
      select
        e.google_connection_id::text as "connectionId",
        gc.credential_generation as generation
      from location_link ll
      join external_location e on e.id = ll.external_location_id
      left join google_connection gc on gc.id = e.google_connection_id
      where ll.location_id = ${input.locationId}
        and ll.is_active = true
      limit 1
    `
    if (
      checkConnection &&
      (!link?.connectionId ||
        link.connectionId.toLowerCase() !==
          (input.connectionId as string).toLowerCase())
    ) {
      return { ok: false, reason: "connection_changed" }
    }
    if (
      checkGeneration &&
      (link?.generation === null ||
        link?.generation === undefined ||
        link.generation !== input.generation)
    ) {
      return { ok: false, reason: "generation_changed" }
    }
  }

  if (input.policy) {
    const [org] = await sql<ApprovalPolicy[]>`
      select
        approval_required as "approvalRequired",
        require_two_person_approval as "requireTwoPersonApproval"
      from organisation
      where id = ${input.organisationId}
    `
    if (
      !org ||
      org.approvalRequired !== input.policy.approvalRequired ||
      org.requireTwoPersonApproval !== input.policy.requireTwoPersonApproval
    ) {
      return { ok: false, reason: "policy_changed" }
    }
  }

  return { ok: true, scope, grant }
}
