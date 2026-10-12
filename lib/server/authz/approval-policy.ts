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
import { ApiError } from "@/lib/server/http"
import { isManagerialRole } from "@/lib/server/permissions"

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
 */
export async function currentManager(
  sql: TransactionSql,
  organisationId: string,
  userId: string
): Promise<GrantScope | null> {
  const scope = await actorScopeFromMembership(sql, organisationId, userId)
  return scope && isManagerialRole(scope.role) ? scope : null
}

const ACCESS_CHANGED = {
  code: "approval_actor_access_changed",
  message:
    "An initiating or approving user's access changed. Generate a new review.",
}

/** 409 unless the user is still an owner or admin. */
export async function requireCurrentManager(
  sql: TransactionSql,
  organisationId: string,
  userId: string,
  refusal: { code: string; message: string } = ACCESS_CHANGED
): Promise<GrantScope> {
  const scope = await currentManager(sql, organisationId, userId)
  if (!scope) throw new ApiError(409, refusal.code, refusal.message)
  return scope
}

/**
 * Pure rule: may `deciderId` approve work `requestedBy` prepared under the
 * frozen two-person flag? Under two-person approval the requester can never
 * be the approver; the tables that record these decisions enforce the same
 * rule (bulk_listing_operation_second_approver, 0261).
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
   * The approver's security version recorded at approval.
   * INTEGRATION: stream A (MFA, P02-S9) records it; until then the column
   * is null and recheckAuthorisation refuses any non-null value it cannot
   * verify.
   */
  approverSecurityVersion?: number | null
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
  })
  if (!approver.ok)
    return { ok: false, reason: approver.reason, subject: "approver" }
  if (!work.perItemApproval && !isManagerialRole(approver.scope.role))
    return { ok: false, reason: "approver_not_manager", subject: "approver" }
  return { ok: true, approver: approver.scope }
}
