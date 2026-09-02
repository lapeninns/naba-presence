"use client"

import { useMutation } from "@tanstack/react-query"

import { publishReview } from "@/lib/api/publish"
import { useInvalidateReviewWrites } from "./invalidate"

export function usePublishReview(reviewId: string) {
  const invalidate = useInvalidateReviewWrites(reviewId)
  return useMutation({
    mutationFn: (input: { draftId: string; expectedReviewUpdateTime: string }) =>
      publishReview(reviewId, input),
    onSuccess: invalidate,
  })
}
