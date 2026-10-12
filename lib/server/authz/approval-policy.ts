import "server-only"

import type { TransactionSql } from "postgres"

import {
  actorScopeFromMembership,
  recheckAuthorisation,
  type ApprovalPolicy,
  type GrantScope,
  type LocationAction,
  type RecheckRefusal,
  type RecheckResult,
} from "@/lib/server/authz/actor"
import {
  accessFromView,
  getOrganisationBilling,
} from "@/lib/server/billing/state"
import { enforcementApplies } from "@/lib/server/entitlement-policy"
import { ApiError } from "@/lib/server/http"
import { isManagerialRole } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

export type { ApprovalPolicy }

// The approval rules every reviewed write shares: reviewed Google change
// sets (lib/server/gbp-change-sets.ts), bulk listing batches
// (lib/server/bulk-listings.ts) and the bulk runner
// (lib/server/bulk-listing-runner.ts). Each of them freezes the
// organisation's two-person flag when the work is prepared, refuses a
// decision when it moved, refuses the requester as their own second
// approver, and only lets owners and admins approve. A worker that
// dispatches later re-derives both people's rights through
// recheckAuthorisation (lib/server/authz/actor.ts) instead of trusting a
// stored role.
//
// Scheduled posts (lib/server/publication-schedules.ts and
// lib/server/publication-schedule-runner.ts) use the same rules.
//
// Every helper expects the tenant transaction from withTenant(organisationId).

/** The organisation's approval policy now. */
export async function currentApprovalPolicy(
  sql: TransactionSql,
  organisationId: string
): Promise<ApprovalPolicy> {
  const [row] = await sql<ApprovalPolicy[]>`
    select
      approval_required as "approvalRequired",
      require_two_person_approval as "requireTwoPersonApproval"
    from organisation
    where id = ${organisationId}
  `
  if (!row)
    throw new ApiError(404, "organisation_not_found", "Organisation not found.")
  return row
}

/**
 * The member's scope when they are still an owner or admin of the
 * organisation, or null (removed, or demoted). Only managers approve
 * reviewed Google changes and bulk batches.
 *
 * With `securityVersion` (the approver's app_user.security_version recorded
 * with the approval, 0106), the person's version must still be that one:
 * operator MFA recovery (scripts/mfa-recover.mjs) bumps it, and an approval
 * given before the recovery no longer stands. Null (an approval recorded
 * before 0106) is not compared.
 */
export async function currentManager(
  sql: TransactionSql,
  organisationId: string,
  userId: string,
  securityVersion: number | null = null
): Promise<GrantScope | null> {
  const scope = await actorScopeFromMembership(sql, organisationId, userId)
  if (!scope || !isManagerialRole(scope.role)) return null
  if (securityVersion !== null) {
    // app_user is visible here: the person is a member of this tenant,
    // which is what app_user's policy admits (0001, 0040).
    const [user] = await sql<{ securityVersion: number }[]>`
      select security_version as "securityVersion"
      from app_user
      where id = ${userId}
    `
    if (!user || user.securityVersion !== securityVersion) return null
  }
  return scope
}

const ACCESS_CHANGED = {
  code: "approval_actor_access_changed",
  message:
    "An initiating or approving user's access changed. Generate a new review.",
}

/**
 * 409 unless the user is still an owner or admin (and, with
 * `securityVersion`, still holds the security version their approval
 * recorded: see currentManager).
 */
export async function requireCurrentManager(
  sql: TransactionSql,
  organisationId: string,
  userId: string,
  {
    securityVersion = null,
    refusal = ACCESS_CHANGED,
  }: {
    securityVersion?: number | null
    refusal?: { code: string; message: string }
  } = {}
): Promise<GrantScope> {
  const scope = await currentManager(
    sql,
    organisationId,
    userId,
    securityVersion
  )
  if (!scope) throw new ApiError(409, refusal.code, refusal.message)
  return scope
}

/**
 * Pure rule: may `deciderId` approve work `requestedBy` prepared under the
 * frozen two-person flag? Under two-person approval the requester can never
 * be the approver; the tables that record these decisions enforce the same
 * rule (bulk_listing_operation_second_approver, 0124).
 */
export function secondApproverSatisfied(
  requireTwoPersonApproval: boolean,
  requestedBy: string,
  deciderId: string
): boolean {
  return !requireTwoPersonApproval || requestedBy !== deciderId
}

export function requireSecondApprover(
  requireTwoPersonApproval: boolean,
  requestedBy: string,
  deciderId: string,
  message = "A different authorised user must approve this change."
) {
  if (
    !secondApproverSatisfied(requireTwoPersonApproval, requestedBy, deciderId)
  )
    throw new ApiError(409, "second_approver_required", message)
}

/**
 * 409 when the organisation's two-person flag is no longer the one frozen
 * into the work. Only the two-person flag is frozen: reviewed changes and
 * bulk batches always need an approval, so `approval_required` does not
 * change what they need.
 */
export async function requireUnchangedTwoPersonPolicy(
  sql: TransactionSql,
  organisationId: string,
  frozenTwoPerson: boolean,
  message = "The approval policy changed. Generate a new review."
): Promise<ApprovalPolicy> {
  const policy = await currentApprovalPolicy(sql, organisationId)
  if (policy.requireTwoPersonApproval !== frozenTwoPerson)
    throw new ApiError(409, "approval_policy_changed", message)
  return policy
}

export type ApprovedWork = {
  organisationId: string
  locationId: string
  requestedBy: string
  approvedBy: string
  /** The two-person flag frozen when the work was prepared. */
  requireTwoPersonApproval: boolean
  /** What the requester must still be allowed to do here (default request_approval). */
  requesterAction?: LocationAction
  /** What the approver must still be allowed to do here (default publish). */
  approverAction?: LocationAction
  /**
   * The Google connection and credential generation frozen with the work.
   * Both are required: work without a frozen target is refused as
   * `connection_changed`, never dispatched against whatever is linked now.
   */
  connectionId: string | null
  generation: number | null
  /**
   * The approver's security version recorded at approval (0106 and the bulk
   * approval columns): recheckAuthorisation (lib/server/authz/actor.ts)
   * refuses with `security_version_changed` once operator MFA recovery has
   * bumped it. Null (an approval recorded before versions were) is not
   * compared.
   */
  approverSecurityVersion?: number | null
  /**
   * The whole approval policy frozen with the work, when it froze more than
   * the two-person flag (scheduled posts also freeze `approval_required`,
   * 0118). Given, the approver's recheck compares both flags and refuses
   * with `policy_changed` when either moved.
   */
  policy?: ApprovalPolicy | null
  /**
   * The work carries no batch-level approval: each item is decided under
   * its own rules when it is sent (bulk review work, where every reply's
   * approval is the review's own: lib/server/review-approval.ts and the
   * publish gates in lib/server/publishing). The frozen two-person flag,
   * the second-approver rule and the manager rule are then not this
   * recheck's to apply; both people's grants for the actions still are.
   */
  perItemApproval?: boolean
}

export type ApprovedWorkRefusal =
  | RecheckRefusal
  | "approval_policy_changed"
  | "second_approver_required"
  | "approver_not_manager"

export type ApprovedWorkResult =
  | { ok: true; approver: GrantScope }
  | {
      ok: false
      reason: ApprovedWorkRefusal
      /** Whose right failed: decides the code a worker settles with. */
      subject: "policy" | "requester" | "approver"
    }

type Recheck = (
  sql: TransactionSql,
  input: Parameters<typeof recheckAuthorisation>[1]
) => Promise<RecheckResult>

/**
 * Immediately before a worker dispatches approved work: the frozen policy
 * still holds, the approver is not the requester under two-person, the
 * requester may still ask for this change here, and the approver may still
 * publish it here as an owner or admin, through the same Google connection
 * and credential generation. Fail-closed: anything unproven is a refusal.
 */
export async function recheckApprovedWork(
  sql: TransactionSql,
  work: ApprovedWork,
  recheck: Recheck = recheckAuthorisation
): Promise<ApprovedWorkResult> {
  if (!work.connectionId || work.generation === null)
    return { ok: false, reason: "connection_changed", subject: "approver" }
  const policy = await currentApprovalPolicy(sql, work.organisationId)
  if (
    !work.perItemApproval &&
    policy.requireTwoPersonApproval !== work.requireTwoPersonApproval
  )
    return { ok: false, reason: "approval_policy_changed", subject: "policy" }
  if (
    !work.perItemApproval &&
    !secondApproverSatisfied(
      work.requireTwoPersonApproval,
      work.requestedBy,
      work.approvedBy
    )
  )
    return { ok: false, reason: "second_approver_required", subject: "policy" }
  const requester = await recheck(sql, {
    organisationId: work.organisationId,
    actorUserId: work.requestedBy,
    locationId: work.locationId,
    action: work.requesterAction ?? "request_approval",
  })
  if (!requester.ok)
    return { ok: false, reason: requester.reason, subject: "requester" }
  const approver = await recheck(sql, {
    organisationId: work.organisationId,
    actorUserId: work.approvedBy,
    locationId: work.locationId,
    action: work.approverAction ?? "publish",
    connectionId: work.connectionId,
    generation: work.generation,
    securityVersion: work.approverSecurityVersion ?? null,
    ...(work.policy ? { policy: work.policy } : {}),
  })
  if (!approver.ok)
    return { ok: false, reason: approver.reason, subject: "approver" }
  if (!work.perItemApproval && !isManagerialRole(approver.scope.role))
    return { ok: false, reason: "approver_not_manager", subject: "approver" }
  return { ok: true, approver: approver.scope }
}

export type ApprovalSessionInput = {
  organisationId: string
  /** The approver the work goes out under. */
  approvedBy: string
  /** Names the worker session in what it records, e.g. `bulk:<operation>`. */
  sessionId: string
  /** The assurance recorded with the approval (0106); null reads as aal1. */
  approvedAal: "aal1" | "aal2" | null
  approvedMfaVerifiedAt: Date | null
  approvedSecurityVersion: number | null
}

/**
 * The session a worker dispatches approved work under: the approver's own
 * membership, person and organisation as they are now, carrying the
 * assurance the approval was given with (0106), not a worker's. Shared by
 * the bulk runner (lib/server/bulk-listing-runner.ts) and the scheduled
 * post runner (lib/server/publication-schedule-runner.ts), after
 * recheckApprovedWork has passed in the same transaction.
 *
 * Billing access is derived as for a person's session (lookupSession,
 * lib/server/session.ts), so anything downstream that asks sessionCanWrite
 * (lib/server/entitlement-policy.ts) gets the organisation's real answer
 * rather than "not enforced". Each runner still holds a read-only
 * organisation itself (organisationWriteBlock) before it gets here.
 *
 * Null when the approver is no longer a member: the caller refuses.
 */
export async function approvalSession(
  sql: TransactionSql,
  input: ApprovalSessionInput,
  now: Date = new Date()
): Promise<Session | null> {
  const [row] = await sql<
    {
      role: Session["role"]
      canPublish: boolean
      email: string
      displayName: string
      organisationName: string
      workspaceMode: Session["workspaceMode"]
    }[]
  >`
    select
      m.role,
      m.can_publish as "canPublish",
      u.email,
      coalesce(u.display_name, '') as "displayName",
      o.name as "organisationName",
      o.workspace_mode as "workspaceMode"
    from member m
    join app_user u on u.id = m.user_id
    join organisation o on o.id = m.organisation_id
    where m.organisation_id = ${input.organisationId}
      and m.user_id = ${input.approvedBy}
  `
  if (!row) return null
  const billing = await getOrganisationBilling(sql, input.organisationId)
  return {
    sessionId: input.sessionId,
    userId: input.approvedBy,
    organisationId: input.organisationId,
    organisationName: row.organisationName,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    canPublish: row.canPublish,
    workspaceMode: row.workspaceMode,
    aal: input.approvedAal ?? "aal1",
    mfaVerifiedAt: input.approvedMfaVerifiedAt,
    securityVersion: input.approvedSecurityVersion ?? undefined,
    access: accessFromView(billing, now),
    entitlementEnforced: enforcementApplies(billing),
  }
}
