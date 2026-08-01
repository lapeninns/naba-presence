import { z } from "zod"

import { apiFetch } from "./client"

const deleteReplyResultSchema = z.object({
  status: z.string(),
  // executeReplyDelete returns attemptId: string | null (a "cancelled" outcome
  // can omit it), so this is nullable.
  publishAttemptId: z.string().nullable(),
})
export type DeleteReplyResult = z.infer<typeof deleteReplyResultSchema>

export function deletePublishedReply(reviewId: string) {
  return apiFetch(`/api/reviews/${reviewId}/reply`, {
    method: "DELETE",
    schema: deleteReplyResultSchema,
  })
}
