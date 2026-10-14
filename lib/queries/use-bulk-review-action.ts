"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { intentFingerprint, mintIntentId } from "@/lib/api/client"
import { runBulkReviewAction } from "@/lib/api/review-bulk"
import type { BulkReviewActionInput } from "@/lib/contracts/reviews"
import { isUnconfirmedFailure } from "@/lib/errors/action-errors"
import { queryKeys } from "@/lib/queries/keys"

/**
 * Intents for calls made outside `useResourceMutation`, by what they send:
 * a call that repeats one whose last attempt may have applied (an uncertain
 * or still-in-flight failure, `isUnconfirmedFailure`) gets that attempt's
 * intent again, so the server answers from its receipt instead of acting
 * twice; anything else gets a fresh one. `settle` records how a call ended.
 */
export function createRetryIntents() {
  const unconfirmed = new Map<string, string | undefined>()
  return {
    take(input: unknown): string | undefined {
      const key = intentFingerprint(input)
      return unconfirmed.has(key) ? unconfirmed.get(key) : mintIntentId()
    },
    settle(input: unknown, intentId: string | undefined, error?: unknown) {
      const key = intentFingerprint(input)
      if (error !== undefined && isUnconfirmedFailure(error)) {
        unconfirmed.set(key, intentId)
      } else {
        unconfirmed.delete(key)
      }
    },
  }
}

export function useRetryIntents() {
  return useState(createRetryIntents)[0]
}

/**
 * Bulk approve, assign or mark-reviewed over a selection.
 *
 * Invalidates every review list and count rather than guessing which filters
 * are live: a bulk approve changes queue membership for rows the operator
 * cannot see, and a stale rail badge after a bulk action is exactly the kind
 * of disagreement the counts rework exists to prevent.
 */
export function useBulkReviewAction() {
  const client = useQueryClient()
  const intents = useRetryIntents()
  return useMutation({
    mutationFn: async (input: BulkReviewActionInput) => {
      const intentId = intents.take(input)
      try {
        const result = await runBulkReviewAction(input, { intentId })
        intents.settle(input, intentId)
        return result
      } catch (error) {
        intents.settle(input, intentId, error)
        throw error
      }
    },
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: queryKeys.reviewsAll })
      void client.invalidateQueries({ queryKey: queryKeys.reviewCountsAll })
      void client.invalidateQueries({ queryKey: queryKeys.clientsAll })
      for (const row of result.results) {
        void client.invalidateQueries({ queryKey: queryKeys.reviewDetail(row.reviewId) })
      }
    },
  })
}
