"use client"

import { useQueryClient } from "@tanstack/react-query"

import { queryKeys } from "./keys"

/**
 * Every review write (draft, verify, approve/reject, publish, delete reply)
 * changes the detail, the list membership under any filter, and the queue
 * counts. One helper so the four mutation hooks cannot drift on which keys
 * they drop.
 */
export function useInvalidateReviewWrites(reviewId: string) {
  const client = useQueryClient()
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.reviewDetail(reviewId) }),
      client.invalidateQueries({ queryKey: queryKeys.reviewsAll }),
      client.invalidateQueries({ queryKey: queryKeys.reviewCountsAll }),
    ])
  }
}
