"use client"

import { useMutation } from "@tanstack/react-query"

import { publishReview } from "@/lib/api/publish"
import { useInvalidateReviewWrites } from "./invalidate"
import { replyMutationKey } from "./use-reply-pending"

export function usePublishReview(reviewId: string) {
  const invalidate = useInvalidateReviewWrites(reviewId)
  return useMutation({
    // Lets the pane's status line see this is in flight; see use-reply-pending.ts.
    mutationKey: replyMutationKey(reviewId, "publish"),
    mutationFn: (input: { draftId: string; expectedReviewUpdateTime: string }) =>
      publishReview(reviewId, input),
    onSuccess: invalidate,
  })
}
