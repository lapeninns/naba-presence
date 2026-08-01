import { z } from "zod"

import { apiFetch } from "./client"

const publishResultSchema = z.object({
  reviewReplyId: z.string(),
  publishAttemptId: z.string(),
  status: z.string(),
  googleReplyState: z.string().nullable(),
  idempotent: z.boolean().optional(),
})
export type PublishResult = z.infer<typeof publishResultSchema>

export function publishReview(
  reviewId: string,
  input: { draftId: string; expectedReviewUpdateTime: string }
) {
  return apiFetch(`/api/reviews/${reviewId}/publish`, {
    method: "POST",
    body: input,
    schema: publishResultSchema,
  })
}
