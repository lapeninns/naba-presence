"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRef } from "react"

import {
  generateOrSaveDraft,
  verifyDraft,
  type DraftInput,
} from "@/lib/api/drafts"
import { intentFingerprint, mintIntentId } from "@/lib/api/client"
import { isUnconfirmedFailure } from "@/lib/errors/action-errors"
import { useInvalidateReviewWrites } from "./invalidate"
import { queryKeys } from "./keys"
import { replyMutationKey } from "./use-reply-pending"

export function useGenerateOrSaveDraft(reviewId: string) {
  const invalidate = useInvalidateReviewWrites(reviewId)
  const client = useQueryClient()
  // The generation id of each input whose last attempt may still have run
  // (an uncertain failure, or `generation_in_progress`): pressing Generate
  // again with the same input resends it, so the server answers from that
  // generation rather than spending a second credit.
  const unconfirmed = useRef(new Map<string, string | undefined>())
  return useMutation({
    // Lets the pane's status line see this is in flight; see use-reply-pending.ts.
    mutationKey: replyMutationKey(reviewId, "draft"),
    mutationFn: async (input: DraftInput) => {
      const key = intentFingerprint(input)
      const intentId = unconfirmed.current.has(key)
        ? unconfirmed.current.get(key)
        : mintIntentId()
      try {
        const result = await generateOrSaveDraft(reviewId, input, {
          intentId,
        })
        unconfirmed.current.delete(key)
        return result
      } catch (error) {
        if (isUnconfirmedFailure(error)) {
          unconfirmed.current.set(key, intentId)
        } else {
          unconfirmed.current.delete(key)
        }
        throw error
      }
    },
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
