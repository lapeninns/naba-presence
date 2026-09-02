import { NextResponse } from "next/server"

import {
  approvalInputSchema,
  reviewIdParamsSchema,
  type ApprovalResult,
} from "@/lib/contracts/reviews"
import { writeAudit } from "@/lib/server/audit"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import {
  canPublishLocation,
  requireLocationAccess,
} from "@/lib/server/permissions"
import { executePublish } from "@/lib/server/publishing"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * Approval product rules:
 * 1. Non-publishers request approval and are recorded as the requester.
 * 2. Approvers need publish authority for the review's location.
 * 3. Two-person mode always requires an approver other than the requester.
 * 4. Two-person mode also routes direct publishers through approval.
 * 5. Approval uses the standard verified, current, idempotent publish pipeline
 *    and attributes the provider mutation to the approver.
 * 6. Rejection returns the reply to draft and records the decision and note.
 */
export const POST = route({
  params: reviewIdParamsSchema,
  body: approvalInputSchema,
  handler: async ({
    session,
    params,
    body: input,
    requestId,
    clientRequestId,
    tenant,
  }) => {
    if (!getServerEnv().PUBLISH_ENABLED) {
      throw new ApiError(
        503,
        "publishing_paused",
        "Publishing is temporarily paused."
      )
    }
    const { id } = params
    const decision = await tenant(async (sql) => {
      const [record] = await sql<
        {
          review_id: string
          workflow_status: string
          update_time: Date
          location_id: string
          review_reply_id: string
          approval_requested_by: string | null
          require_two_person_approval: boolean
          draft_id: string | null
        }[]
      >`
        select
          r.id::text as review_id,
          r.workflow_status,
          r.update_time,
          r.location_id::text as location_id,
          rr.id::text as review_reply_id,
          rr.approval_requested_by::text as approval_requested_by,
          o.require_two_person_approval,
          latest_draft.id::text as draft_id
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
        where r.id = ${id}
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
      if (!record.draft_id) {
        throw new ApiError(
          409,
          "verified_draft_required",
          "A verified draft is required for approval."
        )
      }

      await sql`
        insert into approval_decision (
          organisation_id,
          review_id,
          draft_id,
          decided_by,
          decision,
          note
        )
        values (
          ${session.organisationId},
          ${record.review_id},
          ${record.draft_id},
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
        requestId,
        metadata: {
          draftId: record.draft_id,
          note: input.note ?? null,
          clientRequestId,
        },
      })

      if (input.decision === "reject") {
        await sql`
          update review_reply
          set
            publish_status = 'not_published',
            approval_requested_by = null
          where id = ${record.review_reply_id}
        `
        await sql`
          update review
          set workflow_status = 'drafted'
          where id = ${record.review_id}
        `
        return { kind: "rejected" as const }
      }
      return {
        kind: "approved" as const,
        draftId: record.draft_id,
        expectedReviewUpdateTime: record.update_time.toISOString(),
      }
    })

    if (decision.kind === "rejected") {
      return { status: "returned_to_draft" } satisfies ApprovalResult
    }
    const outcome = await executePublish({
      organisationId: session.organisationId,
      session,
      reviewId: id,
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
    return NextResponse.json({
      status: outcome.status,
      googleReplyState: outcome.googleReplyState,
      publishAttemptId: outcome.attemptId,
      reviewReplyId: outcome.reviewReplyId,
      idempotent: outcome.idempotent,
    } satisfies ApprovalResult)
  },
})
