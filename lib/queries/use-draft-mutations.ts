"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { generateOrSaveDraft, verifyDraft, type DraftInput } from "@/lib/api/drafts"
import { queryKeys } from "./keys"

function useInvalidateReviewWrites(reviewId: string) {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: queryKeys.reviewDetail(reviewId) })
    void client.invalidateQueries({ queryKey: ["reviews"] })
    void client.invalidateQueries({ queryKey: ["review-counts"] })
  }
}

export function useGenerateOrSaveDraft(reviewId: string) {
  const invalidate = useInvalidateReviewWrites(reviewId)
  return useMutation({
    mutationFn: (input: DraftInput) => generateOrSaveDraft(reviewId, input),
    onSuccess: invalidate,
  })
}

export function useVerifyDraft(reviewId: string) {
  const invalidate = useInvalidateReviewWrites(reviewId)
  return useMutation({
    mutationFn: (draftId: string) => verifyDraft(draftId),
    onSuccess: invalidate,
  })
}
