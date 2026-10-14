"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { decideApproval } from "@/lib/api/approval"
import { refreshStaleReview, useApplyReviewWrite } from "./invalidate"
import { replyMutationKey } from "./use-reply-pending"

export function useApprovalDecision(reviewId: string) {
  const apply = useApplyReviewWrite(reviewId)
  const client = useQueryClient()
  return useMutation({
    // Lets the pane's status line see this is in flight; see use-reply-pending.ts.
    mutationKey: replyMutationKey(reviewId, "approval"),
    mutationFn: (input: { decision: "approve" | "reject"; note?: string }) =>
      decideApproval(reviewId, input),
    onSuccess: apply,
    // `approval_draft_changed` / `review_changed`: show the current text.
    onError: () => refreshStaleReview(client, reviewId),
  })
}
