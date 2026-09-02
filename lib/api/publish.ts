import { publishResultSchema, type PublishInput } from "@/lib/contracts/reviews"

import { apiFetch } from "./client"

export type { PublishInput, PublishResult } from "@/lib/contracts/reviews"

export function publishReview(reviewId: string, input: PublishInput) {
  return apiFetch(`/api/reviews/${reviewId}/publish`, {
    method: "POST",
    body: input,
    schema: publishResultSchema,
  })
}
