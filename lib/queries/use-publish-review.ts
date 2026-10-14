"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { publishReview } from "@/lib/api/publish"
import { refreshStaleReview, useApplyReviewWrite } from "./invalidate"
import { replyMutationKey } from "./use-reply-pending"

export function usePublishReview(reviewId: string) {
  const apply = useApplyReviewWrite(reviewId)
  const client = useQueryClient()
  return useMutation({
    // Lets the pane's status line see this is in flight; see use-reply-pending.ts.
    mutationKey: replyMutationKey(reviewId, "publish"),
    mutationFn: (input: { draftId: string; expectedReviewUpdateTime: string }) =>
      publishReview(reviewId, input),
    onSuccess: apply,
    // A refusal (the review or draft moved on) means the pane is stale.
    onError: () => refreshStaleReview(client, reviewId),
  })
}
