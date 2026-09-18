"use client"

import { useMutation } from "@tanstack/react-query"

import { generateOrSaveDraft, verifyDraft, type DraftInput } from "@/lib/api/drafts"
import { useInvalidateReviewWrites } from "./invalidate"
import { replyMutationKey } from "./use-reply-pending"

export function useGenerateOrSaveDraft(reviewId: string) {
  const invalidate = useInvalidateReviewWrites(reviewId)
  return useMutation({
    // Lets the pane's status line see this is in flight; see use-reply-pending.ts.
    mutationKey: replyMutationKey(reviewId, "draft"),
    mutationFn: (input: DraftInput) => generateOrSaveDraft(reviewId, input),
    onSuccess: invalidate,
  })
}

export function useVerifyDraft(reviewId: string) {
  const invalidate = useInvalidateReviewWrites(reviewId)
  return useMutation({
    mutationKey: replyMutationKey(reviewId, "draft"),
    mutationFn: (draftId: string) => verifyDraft(draftId),
    onSuccess: invalidate,
  })
}
