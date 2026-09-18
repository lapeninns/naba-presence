"use client"

import { useMutation } from "@tanstack/react-query"

import { decideApproval } from "@/lib/api/approval"
import { useInvalidateReviewWrites } from "./invalidate"
import { replyMutationKey } from "./use-reply-pending"

export function useApprovalDecision(reviewId: string) {
  const invalidate = useInvalidateReviewWrites(reviewId)
  return useMutation({
    // Lets the pane's status line see this is in flight; see use-reply-pending.ts.
    mutationKey: replyMutationKey(reviewId, "approval"),
    mutationFn: (input: { decision: "approve" | "reject"; note?: string }) =>
      decideApproval(reviewId, input),
    onSuccess: invalidate,
  })
}
