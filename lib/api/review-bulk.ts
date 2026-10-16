import type { BulkReviewActionInput } from "@/lib/contracts/reviews"

import { apiFetch, type MutationOptions } from "./client"

// A bulk approve or template start sent with an intent is started once: a
// retry under the same intent is answered with the first start's batch.
export function runBulkReviewAction(
  input: BulkReviewActionInput,
  options: MutationOptions = {}
) {
  return apiFetch("/api/reviews/bulk", {
    method: "POST",
    body: input,
    schema: () =>
      import("@/lib/contracts/reviews").then((m) => m.bulkReviewResultSchema),
    intentId: options.intentId,
  })
}
