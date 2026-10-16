import type { TransactionSql } from "postgres"

import {
  type BulkApprovalItem,
  bulkReviewActionSchema,
  type BulkReviewResult,
} from "@/lib/contracts/reviews"
import { writeAudit } from "@/lib/server/audit"
import { recheckAuthorisation } from "@/lib/server/authz/actor"
import {
  bulkReviewEngineEnabled,
  startBulkReviewApprovals,
  startBulkTemplateReplies,
} from "@/lib/server/bulk-reviews"
import { ApiError } from "@/lib/server/http"
import { hasTimeFor } from "@/lib/server/deadline"
import { getServerEnv } from "@/lib/server/env"
import { requireRecentMfa } from "@/lib/server/mfa"
import { requireScopesEnabled } from "@/lib/server/pause-controls"
import { requireLocationAction } from "@/lib/server/permissions"
import { REPLY_PUBLISHING_PAUSED } from "@/lib/server/publishing"
import {
  type ApprovalDecision,
  completeApproval,
  recordApprovalDecision,
} from "@/lib/server/review-approval"
import { rowFromApproval, rowFromError } from "@/lib/server/review-bulk-outcome"
import { route, type TenantRunner } from "@/lib/server/route"
import type { Session } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 120

type Row = BulkReviewResult["results"][number]

/**
 * Bulk triage over a selection in the inbox.
 *
 * Never fails the whole batch. Reviews move underneath an operator all the
 * time — a colleague approves one, Google edits another — so a single stale
 * row must not discard the other ninety-nine decisions. Each id gets its own
 * outcome and its own error code, and the UI reports "17 approved, 3 skipped"
 * with the reasons.
 *
 * Approval reuses `lib/server/review-approval.ts`, the same module the
 * single-review route calls, so bulk cannot become a way around the
 * two-person rule or the publish-permission check. Each approval names the
 * draft and review version the operator was shown, and a row whose draft or
 * review has moved is refused rather than approved on their behalf. Outcomes
 * are truthful about the two commits an approval spans (see approveRow), and
 * an unexpected fault on one row becomes that row's outcome, never the
 * batch's.
 *
 * Every action here changes the review, so viewers are refused outright;
 * each row then needs `triage` or `assign` at its own location
 * (requireLocationAction), and an assignee must be a member of this
 * organisation who could edit that review themselves.
 *
 * With the organisation's `bulk_actions` feature on, approve and template
 * replies run on the bulk engine instead (lib/server/bulk-reviews.ts): the
 * rows are checked (and approvals recorded) here, the publishes are sent by
 * the job runner, and the answer names the batch to follow
 * (`operationId`, rows `queued`). Without it, approve stays this per-row
 * loop and template replies are not offered here (404 feature_disabled;
 * the inbox runs them itself). Assign, "no reply needed" and its undo are
 * always synchronous.
 *
 * The per-row approve loop publishes to Google one row after another inside
 * this request, so it stops at the request deadline (lib/server/deadline.ts)
 * instead of being killed mid-publish: a row is only started while one whole
 * publish (its write and its readback) still fits, and every row after that
 * is `skipped` with `bulk_time_budget_reached` — nothing was recorded or sent
 * for it, so the operator can approve it again.
 */
export const POST = route({
  maxDuration,
  roles: ["owner", "admin", "member"],
  body: bulkReviewActionSchema,
  // Approve and template replies publish (or queue) a reply per row; assign
  // and "no reply needed" are local writes and stay unlimited (W3-07).
  limits: ({ session, body }) =>
    body.action === "approve" || body.action === "template_reply"
      ? {
          scope: "bulk_request",
          user: session.userId,
          organisation: session.organisationId,
        }
      : null,
  handler: async ({
    session,
    body,
    requestId,
    clientRequestId,
    tenant,
    deadline,
  }) => {
    if (body.action === "approve" || body.action === "template_reply") {
      // Approving publishes, and so does a template-reply batch (its starter
      // decides it; the approval records this session's assurance, 0106);
      // triage and assignment stay allowed at aal1.
      requireRecentMfa(session)
      await requireScopesEnabled("publish", REPLY_PUBLISHING_PAUSED)
    }

    const engine = await tenant((sql) =>
      bulkReviewEngineEnabled(sql, session.organisationId)
    )
    if (body.action === "template_reply") {
      if (!engine)
        throw new ApiError(
          404,
          "feature_disabled",
          "Bulk changes are not available for this workspace."
        )
      await requireScopesEnabled("publish", REPLY_PUBLISHING_PAUSED)
      return startBulkTemplateReplies(session, body, {
        requestId,
        clientRequestId,
      }) satisfies Promise<BulkReviewResult>
    }
    if (body.action === "approve" && engine) {
      return startBulkReviewApprovals(session, body.approvals, {
        requestId,
        clientRequestId,
      }) satisfies Promise<BulkReviewResult>
    }

    const results: Row[] = []

    if (body.action === "approve") {
      const env = getServerEnv()
      const rowBudgetMs = env.GOOGLE_MUTATION_TIMEOUT_MS + env.GOOGLE_TIMEOUT_MS
      for (const item of body.approvals) {
        if (!hasTimeFor(deadline, rowBudgetMs)) {
          results.push({
            reviewId: item.reviewId,
            status: "skipped",
            code: "bulk_time_budget_reached",
          })
          continue
        }
        results.push(
          await approveRow(session, item, {
            requestId,
            clientRequestId,
            tenant,
          })
        )
      }
      return { results } satisfies BulkReviewResult
    }

    for (const reviewId of body.reviewIds) {
      try {
        await tenant(async (sql) => {
          const [review] = await sql<{ locationId: string }[]>`
            select location_id::text as "locationId" from review where id = ${reviewId}
          `
          if (!review) {
            throw new ApiError(404, "review_not_found", "Review not found.")
          }
          await requireLocationAction(
            sql,
            session,
            review.locationId,
            body.action === "assign" ? "assign" : "triage"
          )

          if (body.action === "assign") {
            if (body.assigneeId) {
              await requireAssigneeEligible(
                sql,
                session.organisationId,
                body.assigneeId,
                review.locationId
              )
            }
            await sql`
              update review
                 set assigned_to = ${body.assigneeId},
                     assigned_at = ${body.assigneeId ? sql`now()` : null}
               where id = ${reviewId}
            `
          } else if (body.action === "mark_unreviewed") {
            // The way back from "no reply needed": the same two columns,
            // cleared. A review that is not triaged is left as it is.
            await sql`
              update review
                 set triaged_at = null, triaged_by = null
               where id = ${reviewId} and triaged_at is not null
            `
          } else {
            // "Reviewed, nothing to say." A five-star review with no text
            // needs no reply, and before this the only way to clear it from
            // the queue was to publish something.
            await sql`
              update review
                 set triaged_at = now(), triaged_by = ${session.userId}
               where id = ${reviewId}
            `
          }

          await writeAudit(sql, {
            organisationId: session.organisationId,
            actorUserId: session.userId,
            action:
              body.action === "assign"
                ? "review.assigned"
                : body.action === "mark_unreviewed"
                  ? "review.untriaged"
                  : "review.triaged",
            subjectType: "review",
            subjectId: reviewId,
            requestId,
            metadata: {
              assigneeId: body.action === "assign" ? body.assigneeId : null,
              clientRequestId,
            },
          })
        })
        results.push({ reviewId, status: "ok" })
      } catch (error) {
        // The row's transaction rolled back, so nothing changed for it.
        results.push(
          rowFromError(reviewId, error, "before_commit", { requestId, session })
        )
      }
    }

    return { results } satisfies BulkReviewResult
  },
})

/**
 * An assignee must be able to act on what they are given: a member of this
 * organisation (not merely an app_user, which is all the foreign key checks)
 * who can see the review's location and is not a viewer. Anyone else would
 * hold a review they cannot open or answer.
 */
async function requireAssigneeEligible(
  sql: TransactionSql,
  organisationId: string,
  assigneeId: string,
  locationId: string
) {
  const eligible = await recheckAuthorisation(sql, {
    organisationId,
    actorUserId: assigneeId,
    locationId,
    action: "edit",
  })
  if (!eligible.ok) {
    throw new ApiError(
      422,
      "assignee_not_eligible",
      "That person cannot work on this review."
    )
  }
}

type RowContext = {
  requestId: string
  clientRequestId?: string | null
  tenant: TenantRunner
}

/**
 * Approve one row and say truthfully what happened to it.
 *
 * Two commits, so two kinds of failure. Anything thrown while recording the
 * decision rolled back with it: the row is skipped (not eligible, or the
 * draft / review moved since the operator saw it) or failed. Once the
 * decision has committed the approval is real, so a publish that then fails
 * is `approved_not_published` (with `publish_retry_scheduled` when the
 * runner will resend it), as is a reply Google answered with REJECTED; one
 * whose outcome Google left unknown is `uncertain`. Neither is "skipped":
 * something did change.
 */
async function approveRow(
  session: Session,
  item: BulkApprovalItem,
  ctx: RowContext
): Promise<Row> {
  let decision: ApprovalDecision
  try {
    decision = await ctx.tenant((sql) =>
      recordApprovalDecision(
        sql,
        session,
        item.reviewId,
        {
          decision: "approve",
          draftId: item.draftId,
          expectedReviewUpdateTime: item.reviewUpdateTime,
        },
        { requestId: ctx.requestId, clientRequestId: ctx.clientRequestId }
      )
    )
  } catch (error) {
    return rowFromError(item.reviewId, error, "before_commit", {
      requestId: ctx.requestId,
      session,
    })
  }
  try {
    const result = await completeApproval(
      session,
      item.reviewId,
      decision,
      ctx.requestId
    )
    return rowFromApproval(item.reviewId, result)
  } catch (error) {
    return rowFromError(item.reviewId, error, "after_approval", {
      requestId: ctx.requestId,
      session,
    })
  }
}
