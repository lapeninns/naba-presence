"use client"

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"

import { fetchReviews, type ReviewRow, type ReviewsFilters } from "@/lib/api/reviews"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useReviews(filters: ReviewsFilters) {
  return useInfiniteQuery({
    queryKey: queryKeys.reviews("organisation", filters),
    queryFn: (ctx) => fetchReviews(filters, ctx.pageParam, requestOptions(ctx)),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: keepPreviousData,
  })
}

export function flattenReviews(
  data: { pages: { items: ReviewRow[] }[] } | undefined
): ReviewRow[] {
  return data ? data.pages.flatMap((page) => page.items) : []
}
