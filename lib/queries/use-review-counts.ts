"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchReviewCounts } from "@/lib/api/review-counts"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export type ReviewCountsScope = {
  locationId?: string
  clientId?: string
  /** Adds the per-client breakdown the inbox rail groups by. */
  groupBy?: "client"
}

/**
 * Accepts the legacy positional location id as well as a scope object, so
 * existing callers keep working while the inbox moves to per-client counts.
 */
export function useReviewCounts(scope?: string | ReviewCountsScope) {
  const scoped: ReviewCountsScope =
    typeof scope === "string" ? { locationId: scope } : (scope ?? {})
  const key = [
    scoped.locationId ?? "organisation",
    scoped.clientId ?? "",
    scoped.groupBy ?? "",
  ]
    .filter(Boolean)
    .join(":")
  return useQuery({
    queryKey: queryKeys.reviewCounts(key),
    queryFn: (ctx) => fetchReviewCounts(scoped, requestOptions(ctx)),
  })
}
