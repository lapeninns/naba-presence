"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import {
  generateOrSaveDraft,
  verifyDraft,
  type DraftInput,
} from "@/lib/api/drafts"
import { useInvalidateReviewWrites } from "./invalidate"
import { queryKeys } from "./keys"
import { replyMutationKey } from "./use-reply-pending"

export function useGenerateOrSaveDraft(reviewId: string) {
  const invalidate = useInvalidateReviewWrites(reviewId)
  const client = useQueryClient()
  return useMutation({
    // Lets the pane's status line see this is in flight; see use-reply-pending.ts.
    mutationKey: replyMutationKey(reviewId, "draft"),
    mutationFn: (input: DraftInput) => generateOrSaveDraft(reviewId, input),
    onSuccess: async () => {
      await Promise.all([
        invalidate(),
        // A generation spends a credit: refresh the balance and the chart.
        client.invalidateQueries({ queryKey: queryKeys.aiCreditsAll }),
      ])
    },
    // A 402 means the balance on screen was stale.
    onError: () =>
      client.invalidateQueries({ queryKey: queryKeys.aiCreditsAll }),
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
