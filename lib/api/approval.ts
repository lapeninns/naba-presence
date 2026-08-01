import { z } from "zod"

import { apiFetch } from "./client"

// The reject and approve responses differ in shape; validate the union of the
// fields either can carry (status is always present).
const approvalResultSchema = z.object({
  status: z.string(),
  googleReplyState: z.string().nullable().optional(),
  publishAttemptId: z.string().optional(),
  reviewReplyId: z.string().optional(),
  idempotent: z.boolean().optional(),
})
export type ApprovalResult = z.infer<typeof approvalResultSchema>

export function decideApproval(
  reviewId: string,
  input: { decision: "approve" | "reject"; note?: string }
) {
  return apiFetch(`/api/reviews/${reviewId}/approval`, {
    method: "POST",
    body: input,
    schema: approvalResultSchema,
  })
}
