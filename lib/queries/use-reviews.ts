"use client"

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"

import { fetchReviews, type ReviewRow, type ReviewsFilters } from "@/lib/api/reviews"
import { settlingInterval } from "@/lib/inbox/settling"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useReviews(filters: ReviewsFilters) {
  return useInfiniteQuery({
    queryKey: queryKeys.reviews("organisation", filters),
    queryFn: (ctx) => fetchReviews(filters, ctx.pageParam, requestOptions(ctx)),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: keepPreviousData,
    // The list carries the same "Sending" pill as the detail pane, so it needs
    // the same poll — otherwise a row settles in the pane and stays stale in
    // the list beside it.
    refetchInterval: (query) =>
      settlingInterval(
        (query.state.data?.pages ?? []).flatMap((page) =>
          page.items.map((item) => item.workflowStatus)
        )
      ),
  })
}

export function flattenReviews(
  data: { pages: { items: ReviewRow[] }[] } | undefined
): ReviewRow[] {
  return data ? data.pages.flatMap((page) => page.items) : []
}
