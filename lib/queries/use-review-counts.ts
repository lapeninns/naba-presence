"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchReviewCounts } from "@/lib/api/review-counts"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useReviewCounts(locationId?: string) {
  return useQuery({
    queryKey: queryKeys.reviewCounts(locationId ?? "organisation"),
    queryFn: (ctx) => fetchReviewCounts(locationId, requestOptions(ctx)),
  })
}
