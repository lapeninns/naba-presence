import "server-only"

import type { ApprovalResult, BulkReviewResult } from "@/lib/contracts/reviews"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import type { Session } from "@/lib/server/session"

type Row = BulkReviewResult["results"][number]

/**
 * Where a bulk row was when it threw:
 * - `before_commit`: inside the row's own transaction, which rolled back, so
 *   nothing changed for it.
 * - `after_approval`: the approval decision had committed and the publish it
 *   implies was under way, so the approval is real whatever happened next.
 */
export type BulkRowPhase = "before_commit" | "after_approval"

/**
 * Google may hold the reply, or a reply, so its state must be read before
 * anyone acts: an unconfirmed write, a live reply that differs from ours
 * (`reply_diverged`), or a publish for the same key still in flight that may
 * yet land (`publish_in_progress`).
 */
const UNCERTAIN_CODES = new Set([
  "google_mutation_ambiguous",
  "reply_diverged",
  "publish_in_progress",
])

/**
 * The publish did not go out but the attempt is parked for the retry runner
 * (a Google 429 or a connection that could not issue a token). The operator
 * cannot re-approve, since the decision is spent, and need not: the runner
 * resends it. Reported under one code so the row says so instead of echoing
 * the provider's "wait and try again".
 */
const RETRY_SCHEDULED_CODE = "publish_retry_scheduled"

function retryIsScheduled(error: ApiError) {
  if (error.code === "publish_retry_not_ready") return true
  const details = error.details as { retryScheduledAt?: unknown } | undefined
  return typeof details?.retryScheduledAt === "string"
}

/**
 * A publish that returned rather than threw. `ok` for approve means Google
 * took the reply (`published`, or `pending` its moderation). A reply Google
 * answered with REJECTED is approved but not live; anything else never
 * reached Google.
 */
export function rowFromApproval(
  reviewId: string,
  result: Pick<ApprovalResult, "status">
): Row {
  if (result.status === "published" || result.status === "pending") {
    return { reviewId, status: "ok" }
  }
  return {
    reviewId,
    status: "approved_not_published",
    code: result.status === "rejected" ? "google_reply_rejected" : "publish_not_sent",
  }
}

/**
 * One error, one honest row outcome. Never rethrows: a fault on row 40 must
 * not discard the 39 outcomes before it, several of which already reached
 * Google.
 *
 * An error that is not an ApiError is unexpected. Before commit it is a
 * failed row; after an approval it is `uncertain`, because the publish may
 * have reached Google before whatever broke. Either way it is logged, since
 * the row only carries a code.
 */
export function rowFromError(
  reviewId: string,
  error: unknown,
  phase: BulkRowPhase,
  ctx: { requestId: string; session: Pick<Session, "organisationId" | "userId"> }
): Row {
  if (error instanceof ApiError) {
    if (phase === "after_approval") {
      if (UNCERTAIN_CODES.has(error.code)) {
        return { reviewId, status: "uncertain", code: error.code }
      }
      return {
        reviewId,
        status: "approved_not_published",
        code: retryIsScheduled(error) ? RETRY_SCHEDULED_CODE : error.code,
      }
    }
    // 4xx means this row was not eligible; the operator should see why and
    // move on. Anything else is a fault on our side.
    return {
      reviewId,
      status: error.status >= 400 && error.status < 500 ? "skipped" : "failed",
      code: error.code,
    }
  }
  log.error("reviews.bulk.row_failed", {
    requestId: ctx.requestId,
    organisationId: ctx.session.organisationId,
    userId: ctx.session.userId,
    reviewId,
    phase,
    error: error instanceof Error ? error.message : String(error),
  })
  return phase === "after_approval"
    ? { reviewId, status: "uncertain", code: "publish_outcome_unknown" }
    : { reviewId, status: "failed", code: "bulk_row_failed" }
}
