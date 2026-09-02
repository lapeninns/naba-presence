"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchReviewDetail } from "@/lib/api/reviews"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useReviewDetail(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reviewDetail(id ?? ""),
    queryFn: (ctx) => fetchReviewDetail(id as string, requestOptions(ctx)),
    enabled: Boolean(id),
  })
}
