"use client"

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"

import { fetchReviews, type ReviewRow, type ReviewsFilters } from "@/lib/api/reviews"
import { queryKeys } from "./keys"

export function useReviews(filters: ReviewsFilters) {
  return useInfiniteQuery({
    queryKey: queryKeys.reviews("organisation", filters),
    queryFn: ({ pageParam }) => fetchReviews(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

export function flattenReviews(
  data: { pages: { items: ReviewRow[] }[] } | undefined
): ReviewRow[] {
  return data ? data.pages.flatMap((page) => page.items) : []
}
