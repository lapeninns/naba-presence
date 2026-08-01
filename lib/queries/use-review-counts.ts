"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchReviewCounts } from "@/lib/api/review-counts"
import { queryKeys } from "./keys"

export function useReviewCounts(locationId?: string) {
  return useQuery({
    queryKey: queryKeys.reviewCounts(locationId ?? "organisation"),
    queryFn: () => fetchReviewCounts(locationId),
    staleTime: 30_000,
  })
}
