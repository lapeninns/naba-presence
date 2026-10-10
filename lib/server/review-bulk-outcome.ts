import "server-only"

import type { BulkReviewResult } from "@/lib/contracts/reviews"
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

/** Google may hold the reply; its state must be read before any retry. */
const UNCERTAIN_CODES = new Set(["google_mutation_ambiguous"])

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
      return {
        reviewId,
        status: UNCERTAIN_CODES.has(error.code) ? "uncertain" : "approved_not_published",
        code: error.code,
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
