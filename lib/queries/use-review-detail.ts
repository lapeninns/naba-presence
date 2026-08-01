"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchReviewDetail } from "@/lib/api/reviews"
import { queryKeys } from "./keys"

export function useReviewDetail(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reviewDetail(id ?? ""),
    queryFn: () => fetchReviewDetail(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  })
}
