"use client"

import { useCallback, useRef } from "react"

import { REVIEW_WORKFLOW_STATES } from "@/lib/domain/workflow"
import type { Review } from "@/lib/naba-presence-data"
import type { ReviewCounts } from "@/lib/naba-presence-api"

export const EMPTY_REVIEW_COUNTS: ReviewCounts = {
  total: 0,
  byStatus: Object.fromEntries(
    REVIEW_WORKFLOW_STATES.map((status) => [status, 0])
  ) as ReviewCounts["byStatus"],
}

export function relativeRefreshTime(value: number | null) {
  if (!value) return "never"
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - value) / 1000))
  if (elapsedSeconds < 60) return "just now"
  const elapsedMinutes = Math.round(elapsedSeconds / 60)
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} ago`
  }
  const elapsedHours = Math.round(elapsedMinutes / 60)
  return `${elapsedHours} hour${elapsedHours === 1 ? "" : "s"} ago`
}

export function mergeLocationDirectory(
  current: Map<string, string>,
  reviews: Review[]
) {
  const next = new Map(current)
  for (const review of reviews) {
    if (review.locationId) next.set(review.location, review.locationId)
  }
  return next
}

export function useQueueRefreshReadiness(
  onRefresh: (succeeded?: boolean) => Promise<void>
) {
  const countsScopeRef = useRef<string | null>(null)
  const reviewsScopeRef = useRef<string | null>(null)

  const beginCounts = useCallback(() => {
    countsScopeRef.current = null
  }, [])
  const beginReviews = useCallback(() => {
    reviewsScopeRef.current = null
  }, [])
  const beginCombined = useCallback(() => {
    countsScopeRef.current = null
    reviewsScopeRef.current = null
  }, [])
  const completeCounts = useCallback(
    (scope: string) => {
      countsScopeRef.current = scope
      if (reviewsScopeRef.current === scope) void onRefresh(true)
    },
    [onRefresh]
  )
  const completeReviews = useCallback(
    (scope: string) => {
      reviewsScopeRef.current = scope
      if (countsScopeRef.current === scope) void onRefresh(true)
    },
    [onRefresh]
  )
  const completeCombined = useCallback(
    async (
      scope: string,
      reviewsSucceeded: boolean,
      countsSucceeded: boolean
    ) => {
      reviewsScopeRef.current = reviewsSucceeded ? scope : null
      await onRefresh(reviewsSucceeded && countsSucceeded)
    },
    [onRefresh]
  )

  return {
    beginCombined,
    beginCounts,
    beginReviews,
    completeCombined,
    completeCounts,
    completeReviews,
  }
}
