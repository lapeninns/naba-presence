"use client"

import { useMutation } from "@tanstack/react-query"

import { generateOrSaveDraft, verifyDraft, type DraftInput } from "@/lib/api/drafts"
import { useInvalidateReviewWrites } from "./invalidate"

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
