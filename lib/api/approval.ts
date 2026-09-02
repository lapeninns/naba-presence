import { approvalResultSchema, type ApprovalInput } from "@/lib/contracts/reviews"

import { apiFetch } from "./client"

export type { ApprovalInput, ApprovalResult } from "@/lib/contracts/reviews"

export function decideApproval(reviewId: string, input: ApprovalInput) {
  return apiFetch(`/api/reviews/${reviewId}/approval`, {
    method: "POST",
    body: input,
    schema: approvalResultSchema,
  })
}
