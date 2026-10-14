"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { runBulkReviewAction } from "@/lib/api/review-bulk"
import { invalidateReviewBatch } from "@/lib/queries/invalidate"

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
  return useMutation({
    mutationFn: runBulkReviewAction,
    onSuccess: (result) =>
      invalidateReviewBatch(
        client,
        result.results.map((row) => row.reviewId)
      ),
  })
}
