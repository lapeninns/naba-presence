"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchReviewCounts } from "@/lib/api/review-counts"
import { queryKeys } from "./keys"

export function useReviewCounts() {
  return useQuery({
    queryKey: queryKeys.reviewCounts("organisation"),
    queryFn: () => fetchReviewCounts(),
    staleTime: 30_000,
  })
}
