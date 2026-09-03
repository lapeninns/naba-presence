import "server-only"

import type { TransactionSql } from "postgres"

import type { ApprovalInput, ApprovalResult } from "@/lib/contracts/reviews"
import { writeAudit } from "@/lib/server/audit"
import { ApiError } from "@/lib/server/http"
import { canPublishLocation, requireLocationAccess } from "@/lib/server/permissions"
import { executePublish } from "@/lib/server/publishing"
import type { Session } from "@/lib/server/session"

/**
 * Approval decisions: THE ONLY implementation.
 *
 * Extracted from `app/api/reviews/[id]/approval/route.ts` so the bulk endpoint
 * can approve several reviews without restating the rules. Approval is the
 * human boundary in front of a provider write — a second copy of these checks
 * that drifts by one condition is exactly how an unapproved reply reaches
 * Google.
 *
 * The product rules, unchanged:
 *  1. Approvers need publish authority for the review's location.
 *  2. Two-person mode always requires an approver other than the requester.
 *  3. The decision names ONE draft: the parked one, never "whichever is
 *     newest", so a stale pane gets a 409 rather than credit for approving
 *     text it never showed.
 *  4. Rejection returns the reply to draft and records the decision.
 */
export type ApprovalDecision =
  | { kind: "rejected" }
  | { kind: "approved"; draftId: string; expectedReviewUpdateTime: string }

export async function recordApprovalDecision(
  sql: TransactionSql,
  session: Session,
  reviewId: string,
  input: ApprovalInput,
  ctx: { requestId: string; clientRequestId?: string | null }
): Promise<ApprovalDecision> {
  const [record] = await sql<
    {
      review_id: string
      workflow_status: string
      update_time: Date
      location_id: string
      review_reply_id: string
      approval_requested_by: string | null
      require_two_person_approval: boolean
      pending_draft_id: string | null
      latest_draft_id: string | null
    }[]
  >`
    select
      r.id::text as review_id,
      r.workflow_status,
      r.update_time,
      r.location_id::text as location_id,
      rr.id::text as review_reply_id,
      rr.approval_requested_by::text as approval_requested_by,
      rr.pending_draft_id::text as pending_draft_id,
      o.require_two_person_approval,
      latest_draft.id::text as latest_draft_id
    from review r
    join review_reply rr on rr.review_id = r.id
    join organisation o on o.id = r.organisation_id
    left join lateral (
      select d.id
      from draft d
      where d.review_id = r.id
        and d.verification_status in ('pass', 'warn')
      order by d.created_at desc
      limit 1
    ) latest_draft on true
    where r.id = ${reviewId}
    limit 1
  `
  if (!record) {
    throw new ApiError(404, "review_not_found", "Review not found.")
  }
  if (record.workflow_status !== "awaiting_approval") {
    throw new ApiError(
      409,
      "approval_not_pending",
      "This review is not awaiting approval."
    )
  }
  await requireLocationAccess(sql, session, record.location_id)
  if (!(await canPublishLocation(sql, session, record.location_id))) {
    throw new ApiError(
      403,
      "publish_permission_required",
      "You do not have publish permission for this location."
    )
  }
  if (
    record.require_two_person_approval &&
    record.approval_requested_by === session.userId
  ) {
    throw new ApiError(
      403,
      "second_approver_required",
      "A different authorised user must approve this reply."
    )
  }
  // The parked draft, not the newest one. `pending_draft_id` is null only for
  // a reply parked before 0039 whose body no longer matches any verified
  // draft; the lateral keeps those decidable. Whether the draft is still
  // publishable is not re-litigated here — executePublish's own gates answer
  // `verification_failed` / `verification_required`, and a rejection must stay
  // possible either way.
  const draftId = record.pending_draft_id ?? record.latest_draft_id
  if (!draftId) {
    throw new ApiError(
      409,
      "verified_draft_required",
      "A verified draft is required for approval."
    )
  }
  if (input.draftId && input.draftId !== draftId) {
    throw new ApiError(
      409,
      "approval_draft_changed",
      "This reply changed after you opened it. Read the current draft before deciding."
    )
  }

  await sql`
    insert into approval_decision (
      organisation_id, review_id, draft_id, decided_by, decision, note
    )
    values (
      ${session.organisationId},
      ${record.review_id},
      ${draftId},
      ${session.userId},
      ${input.decision === "approve" ? "approved" : "rejected"},
      ${input.note ?? null}
    )
  `
  await writeAudit(sql, {
    organisationId: session.organisationId,
    actorUserId: session.userId,
    action:
      input.decision === "approve"
        ? "review.approval.approved"
        : "review.approval.rejected",
    subjectType: "review",
    subjectId: record.review_id,
    requestId: ctx.requestId,
    metadata: {
      draftId,
      note: input.note ?? null,
      clientRequestId: ctx.clientRequestId,
    },
  })

  if (input.decision === "reject") {
    // pending_draft_id follows publish_status out of 'awaiting_approval' via
    // review_reply_pending_draft (0039), so the rejected draft cannot outlive
    // its decision.
    await sql`
      update review_reply
      set publish_status = 'not_published', approval_requested_by = null
      where id = ${record.review_reply_id}
    `
    await sql`
      update review set workflow_status = 'drafted' where id = ${record.review_id}
    `
    return { kind: "rejected" }
  }
  return {
    kind: "approved",
    draftId,
    expectedReviewUpdateTime: record.update_time.toISOString(),
  }
}

/**
 * Runs the publish an approval implies, OUTSIDE the tenant transaction: the
 * provider call must not hold a database transaction open, and an ambiguous
 * result has to be reportable rather than rolled back into silence.
 */
export async function completeApproval(
  session: Session,
  reviewId: string,
  decision: ApprovalDecision,
  requestId: string
): Promise<ApprovalResult> {
  if (decision.kind === "rejected") {
    return { status: "returned_to_draft" }
  }
  const outcome = await executePublish({
    organisationId: session.organisationId,
    session,
    reviewId,
    draftId: decision.draftId,
    expectedReviewUpdateTime: decision.expectedReviewUpdateTime,
    requestId,
  })
  if (outcome.status === "ambiguous") {
    throw new ApiError(
      502,
      "google_mutation_ambiguous",
      "Google may have applied the reply. Its state must be checked before retrying."
    )
  }
  if (outcome.status === "failed") {
    throw new ApiError(
      outcome.providerError?.status === 429 ? 429 : 409,
      outcome.providerError?.code ?? "google_publish_failed",
      outcome.providerError?.message ?? "Google rejected the reply."
    )
  }
  return {
    status: outcome.status,
    googleReplyState: outcome.googleReplyState,
    publishAttemptId: outcome.attemptId,
    reviewReplyId: outcome.reviewReplyId,
    idempotent: outcome.idempotent,
  }
}
