import {
  bulkReviewResultSchema,
  type BulkReviewActionInput,
} from "@/lib/contracts/reviews"

import { apiFetch } from "./client"

export function runBulkReviewAction(input: BulkReviewActionInput) {
  return apiFetch("/api/reviews/bulk", {
    method: "POST",
    body: input,
    schema: bulkReviewResultSchema,
  })
}
