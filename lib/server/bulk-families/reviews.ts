import "server-only"

import type { TransactionSql } from "postgres"

import { draftInputSchema } from "@/lib/contracts/reviews"
import type {
  BulkReviewApprovalInput,
  BulkReviewTemplateInput,
} from "@/lib/domain/bulk-reviews"
import { uuidFromSeed } from "@/lib/server/bulk-families/shared"
import type {
  BulkFamily,
  DispatchContext,
  DispatchOutcome,
  ReconcileOutcome,
} from "@/lib/server/bulk-families/types"
import { withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { executePublish, type PublishOutcome } from "@/lib/server/publishing"
import { createReviewDraft } from "@/lib/server/review-drafts"

/**
 * Bulk review work (P09-R8) on the bulk engine: one child per review, sent
 * by the job runner, so a batch's outcomes survive the tab that started it.
 *
 * Nothing here is a new way to publish. Every child goes through
 * `executePublish` (lib/server/publishing), the single-reply pipeline with
 * its gates, approval routing, idempotency key and recovery, and a template
 * child drafts through `createReviewDraft`, the drafts route's own code.
 * The runner rechecks the batch's person before each child
 * (`recheck`), and the reply pipeline applies the review's approval rules
 * when it sends.
 *
 * Exactly once: a re-run claim (a crashed tick, a lease reclaim, a retry)
 * finds the template draft by its id derived from the child, and
 * `executePublish` finds any earlier attempt under the reply's idempotency
 * key, reading Google back before it sends anything. A child whose publish
 * is unresolved (an ambiguous write, or a 429 parked for the reply retry
 * runner) waits on that publish attempt and settles from it
 * (`reconcileAttempt`), never by sending again from the batch.
 */

/** The template draft a child makes, by id: one per child, ever. */
export const bulkReviewDraftId = (childId: string) =>
  uuidFromSeed(`bulk_review_template_draft:${childId}`)

/** Codes the reply pipeline answers while an earlier publish is under way. */
const WAITING_CODES = new Set([
  "publish_retry_not_ready",
  "publish_in_progress",
])

/** Publish attempt states the reply pipeline is still resolving. */
const UNRESOLVED_ATTEMPT = new Set([
  "started",
  "accepted",
  "retryable",
  "ambiguous",
])

/** The latest publish attempt for a review's draft, the child's receipt. */
async function latestAttempt(
  organisationId: string,
  reviewId: string,
  draftId: string
) {
  const [row] = await withTenant(
    organisationId,
    (sql) => sql<{ id: string; status: string }[]>`
      select pa.id::text as id, pa.status
      from publish_attempt pa
      join review_reply rr on rr.id = pa.review_reply_id
      where rr.review_id = ${reviewId} and pa.draft_id = ${draftId}
        and pa.operation = 'publish'
      order by pa.started_at desc, pa.id desc
      limit 1`
  )
  return row ?? null
}

/**
 * Sends one draft through the reply pipeline as the batch's person and
 * says what that means for the child.
 */
async function publishDraft(
  context: DispatchContext<BulkReviewApprovalInput | BulkReviewTemplateInput>,
  draftId: string,
  expectedReviewUpdateTime: string
): Promise<DispatchOutcome> {
  const reviewId = context.input.reviewId
  let outcome: PublishOutcome
  try {
    outcome = await executePublish({
      organisationId: context.organisationId,
      session: context.session,
      reviewId,
      draftId,
      expectedReviewUpdateTime,
      requestId: context.requestId,
    })
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    // The operator pause (or PUBLISH_ENABLED off) holds the batch; the
    // child is claimed again once publishing resumes.
    if (error.code === "publishing_paused")
      return { kind: "deferred", code: error.code }
    if (WAITING_CODES.has(error.code)) {
      const attempt = await latestAttempt(
        context.organisationId,
        reviewId,
        draftId
      )
      return attempt
        ? {
            kind: "ambiguous",
            code:
              error.code === "publish_retry_not_ready"
                ? "publish_retry_scheduled"
                : error.code,
            publishAttemptId: attempt.id,
          }
        : { kind: "deferred", code: error.code }
    }
    // The review or the draft moved, or the person lost the right: this
    // review needs a person, the rest of the batch carries on.
    return error.status === 409
      ? { kind: "conflict", code: error.code }
      : { kind: "failed", code: error.code }
  }
  const observed = { reviewId, draftId, replyStatus: outcome.status }
  switch (outcome.status) {
    case "published":
    case "pending":
      return {
        kind: "succeeded",
        confirmation: "confirmed",
        publishAttemptId: outcome.attemptId,
        observed,
      }
    // Parked for someone else's approval: nothing went to Google, which is
    // what the batch asked for when its person may not publish here.
    case "awaiting_approval":
      return {
        kind: "succeeded",
        confirmation: "confirmed",
        code: "submitted_for_approval",
        observed,
      }
    case "rejected":
      return {
        kind: "failed",
        code: "google_reply_rejected",
        publishAttemptId: outcome.attemptId,
        observed,
      }
    case "ambiguous":
      return {
        kind: "ambiguous",
        code: "response_ambiguous",
        publishAttemptId: outcome.attemptId,
        observed,
      }
    case "failed":
      // A 429 (or a blocked connection) is parked for the reply retry
      // runner, which resends it: the child waits on that attempt.
      return outcome.retryScheduledAt
        ? {
            kind: "ambiguous",
            code: "publish_retry_scheduled",
            publishAttemptId: outcome.attemptId,
            observed,
          }
        : {
            kind: "failed",
            code: `provider_rejected:${outcome.providerError?.code ?? "google_publish_failed"}`,
            publishAttemptId: outcome.attemptId,
            observed,
          }
  }
}

/**
 * A review child left waiting on its publish attempt settles once the
 * reply pipeline has: the job runner's retry resends a parked attempt and
 * its readback resolves an ambiguous one (lib/server/jobs.ts).
 */
async function reconcileAttempt(
  sql: TransactionSql,
  child: { publishAttemptId: string }
): Promise<ReconcileOutcome | null> {
  const [attempt] = await sql<
    { status: string; errorCode: string | null; replyStatus: string | null }[]
  >`
    select pa.status, pa.provider_error_code as "errorCode", rr.publish_status as "replyStatus"
    from publish_attempt pa join review_reply rr on rr.id = pa.review_reply_id
    where pa.id = ${child.publishAttemptId}`
  if (!attempt) return { kind: "failed", code: "publish_attempt_missing" }
  switch (attempt.status) {
    case "succeeded":
      return attempt.replyStatus === "rejected"
        ? { kind: "failed", code: "google_reply_rejected" }
        : { kind: "succeeded", confirmation: "confirmed" }
    case "failed":
      return {
        kind: "failed",
        code: `publish_failed${attempt.errorCode ? `:${attempt.errorCode}` : ""}`,
      }
    case "superseded":
      return { kind: "failed", code: "publish_superseded" }
    default:
      return null
  }
}

const shared = {
  resourceKey: "reviews",
  // The reply pipeline checks the `publish` scope itself (executePublish).
  writeSurface: null,
  accountLock: false,
  async plan() {
    // Review batches are started from the inbox, never previewed as a
    // listing change (bulkChangeListSchema refuses them).
    throw new ApiError(
      400,
      "bulk_review_not_previewable",
      "Review replies are sent from the inbox."
    )
  },
  // No mutation receipt: review children wait on their publish attempt.
  reconcile: () => null,
  reconcileAttempt,
} as const

/**
 * Approvals: the decision was recorded when the batch started (with the
 * draft and review version the approver was shown), so the child only
 * publishes that draft, and only while the decision still stands: a
 * rejection, a newer decision or a review returned to draft since means a
 * person changed their mind, and the child does not overrule them.
 */
export const reviewApprovalFamily: BulkFamily<BulkReviewApprovalInput> = {
  ...shared,
  operations: ["review_approval"],
  recheck: {
    requesterAction: "decide_approval",
    approverAction: "publish",
    perItemApproval: true,
  },
  async dispatch(context) {
    if (!context.stillOpen()) return { kind: "expired" }
    const { reviewId, draftId, reviewUpdateTime } = context.input
    const [state] = await withTenant(
      context.organisationId,
      (sql) => sql<
        {
          workflowStatus: string
          locationId: string
          decision: string | null
          decisionDraftId: string | null
          decidedBy: string | null
          attemptId: string | null
          attemptStatus: string | null
          replyStatus: string | null
        }[]
      >`
        select r.workflow_status as "workflowStatus", r.location_id::text as "locationId",
          d.decision, d.draft_id::text as "decisionDraftId", d.decided_by::text as "decidedBy",
          a.id::text as "attemptId", a.status as "attemptStatus", a.reply_status as "replyStatus"
        from review r
        left join lateral (
          select decision, draft_id, decided_by from approval_decision
          where review_id = r.id order by created_at desc, id desc limit 1
        ) d on true
        left join lateral (
          select pa.id, pa.status, rr.publish_status as reply_status
          from publish_attempt pa join review_reply rr on rr.id = pa.review_reply_id
          where rr.review_id = r.id and pa.draft_id = ${draftId} and pa.operation = 'publish'
          order by pa.started_at desc, pa.id desc limit 1
        ) a on true
        where r.id = ${reviewId} and r.provider_deleted_at is null`
    )
    if (!state || state.locationId !== context.locationId)
      return { kind: "failed", code: "review_not_found" }
    if (
      state.decision !== "approved" ||
      state.decisionDraftId !== draftId ||
      state.decidedBy !== context.session.userId ||
      ["new", "drafted", "verified"].includes(state.workflowStatus)
    ) {
      // The decision moved, but this very draft may already have gone out
      // another way (a second approver published it): the batch reports
      // what happened to the reply rather than a withdrawal.
      if (
        state.attemptId &&
        state.attemptStatus === "succeeded" &&
        state.replyStatus !== "rejected"
      )
        return {
          kind: "succeeded",
          confirmation: "confirmed",
          publishAttemptId: state.attemptId,
          observed: { reviewId, draftId, replyStatus: state.replyStatus },
        }
      if (state.attemptId && UNRESOLVED_ATTEMPT.has(state.attemptStatus ?? ""))
        return {
          kind: "ambiguous",
          code: "publish_in_progress",
          publishAttemptId: state.attemptId,
        }
      return { kind: "conflict", code: "approval_withdrawn" }
    }
    const result = await publishDraft(
      context,
      draftId,
      new Date(reviewUpdateTime).toISOString()
    )
    // An approval batch publishes what its person approved. A reply parked
    // again (a stricter approval rule since the batch started) is not sent,
    // so it is not a success here.
    return result.kind === "succeeded" &&
      result.code === "submitted_for_approval"
      ? {
          kind: "conflict",
          code: "approval_not_sufficient",
          observed: result.observed,
        }
      : result
  },
}

/**
 * Template replies: draft the rating template for a review that still has
 * no text, no draft and no reply (as when the batch started), check it,
 * then publish it, or submit it for approval where the batch's person may
 * not publish. A draft that fails its checks stays in the inbox for a
 * person and is never sent.
 */
export const reviewTemplateReplyFamily: BulkFamily<BulkReviewTemplateInput> = {
  ...shared,
  operations: ["review_template_reply"],
  recheck: {
    requesterAction: "request_approval",
    approverAction: "request_approval",
    perItemApproval: true,
  },
  async dispatch(context) {
    if (!context.stillOpen()) return { kind: "expired" }
    const { reviewId, reviewUpdateTime } = context.input
    const draftId = bulkReviewDraftId(context.childId)
    const [state] = await withTenant(
      context.organisationId,
      (sql) => sql<
        {
          locationId: string
          updateTime: Date
          ours: string | null
          otherDraft: boolean
          hasReply: boolean
          workflowStatus: string
          text: string | null
        }[]
      >`
        select r.location_id::text as "locationId", r.update_time as "updateTime", r.workflow_status as "workflowStatus",
          r.review_text as text,
          (select d.verification_status from draft d where d.id = ${draftId} and d.review_id = r.id) as ours,
          exists (select 1 from draft d where d.review_id = r.id and d.id <> ${draftId}) as "otherDraft",
          exists (select 1 from review_reply rr where rr.review_id = r.id and rr.current_body is not null
            and rr.publish_status <> 'deleted') as "hasReply"
        from review r where r.id = ${reviewId} and r.provider_deleted_at is null`
    )
    if (!state || state.locationId !== context.locationId)
      return { kind: "failed", code: "review_not_found" }
    let verification = state.ours
    if (verification === null) {
      // First time through: the review must still be as the batch found it.
      if (
        state.updateTime.toISOString() !==
        new Date(reviewUpdateTime).toISOString()
      )
        return { kind: "conflict", code: "review_changed" }
      if (state.text?.trim())
        return { kind: "conflict", code: "template_review_has_text" }
      if (state.hasReply)
        return { kind: "conflict", code: "template_has_reply" }
      if (state.otherDraft || state.workflowStatus !== "new")
        return { kind: "conflict", code: "template_review_busy" }
      try {
        const draft = await createReviewDraft({
          session: context.session,
          reviewId,
          input: draftInputSchema.parse({}),
          // One key per child claim: the tick's request id is shared by
          // every child it runs, and the verification call's ledger key is
          // derived from this one, so a shared id would collide.
          requestId: `${context.requestId}:${context.intentId}`,
          tenant: (work) => withTenant(context.organisationId, work),
          draftId,
          templateOnly: true,
        })
        verification = draft.verification.verdict
      } catch (error) {
        if (!(error instanceof ApiError)) throw error
        if (error.code === "drafts_paused")
          return { kind: "deferred", code: error.code }
        return error.status === 409
          ? { kind: "conflict", code: error.code }
          : { kind: "failed", code: error.code }
      }
    }
    if (verification !== "pass" && verification !== "warn")
      return {
        kind: "failed",
        code:
          verification === "fail"
            ? "verification_failed"
            : "verification_required",
        observed: { reviewId, draftId, replyStatus: null },
      }
    // Bound to the review as the batch found it: a review edited since the
    // draft was made is refused by the publish gates (review_changed).
    return publishDraft(
      context,
      draftId,
      new Date(reviewUpdateTime).toISOString()
    )
  },
}
