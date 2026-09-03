import {
  bulkReviewActionSchema,
  type BulkReviewResult,
} from "@/lib/contracts/reviews"
import { writeAudit } from "@/lib/server/audit"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { requireLocationAccess } from "@/lib/server/permissions"
import {
  completeApproval,
  recordApprovalDecision,
} from "@/lib/server/review-approval"
import { route } from "@/lib/server/route"

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
 * two-person rule or the publish-permission check.
 */
export const POST = route({
  body: bulkReviewActionSchema,
  handler: async ({ session, body, requestId, clientRequestId, tenant }) => {
    if (body.action === "approve" && !getServerEnv().PUBLISH_ENABLED) {
      throw new ApiError(503, "publishing_paused", "Publishing is temporarily paused.")
    }

    const results: Row[] = []

    for (const reviewId of body.reviewIds) {
      try {
        if (body.action === "approve") {
          const decision = await tenant((sql) =>
            recordApprovalDecision(
              sql,
              session,
              reviewId,
              { decision: "approve" },
              { requestId, clientRequestId }
            )
          )
          await completeApproval(session, reviewId, decision, requestId)
          results.push({ reviewId, status: "ok" })
          continue
        }

        await tenant(async (sql) => {
          const [review] = await sql<{ locationId: string }[]>`
            select location_id::text as "locationId" from review where id = ${reviewId}
          `
          if (!review) {
            throw new ApiError(404, "review_not_found", "Review not found.")
          }
          await requireLocationAccess(sql, session, review.locationId)

          if (body.action === "assign") {
            await sql`
              update review
                 set assigned_to = ${body.assigneeId ?? null},
                     assigned_at = ${body.assigneeId ? sql`now()` : null}
               where id = ${reviewId}
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
            action: body.action === "assign" ? "review.assigned" : "review.triaged",
            subjectType: "review",
            subjectId: reviewId,
            requestId,
            metadata: { assigneeId: body.assigneeId ?? null, clientRequestId },
          })
        })
        results.push({ reviewId, status: "ok" })
      } catch (error) {
        if (error instanceof ApiError) {
          // 4xx means this row was not eligible; the operator should see why
          // and move on. Anything else is a real fault and stops the batch.
          if (error.status >= 400 && error.status < 500) {
            results.push({ reviewId, status: "skipped", code: error.code })
            continue
          }
          results.push({ reviewId, status: "failed", code: error.code })
          continue
        }
        throw error
      }
    }

    return { results } satisfies BulkReviewResult
  },
})
