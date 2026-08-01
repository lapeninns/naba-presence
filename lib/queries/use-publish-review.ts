"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { publishReview } from "@/lib/api/publish"
import { queryKeys } from "./keys"

export function usePublishReview(reviewId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { draftId: string; expectedReviewUpdateTime: string }) =>
      publishReview(reviewId, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.reviewDetail(reviewId) })
      void client.invalidateQueries({ queryKey: ["reviews"] })
      void client.invalidateQueries({ queryKey: ["review-counts"] })
    },
  })
}
