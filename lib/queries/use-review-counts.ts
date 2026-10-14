"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchReviewCounts } from "@/lib/api/review-counts"
import { settlingInterval } from "@/lib/inbox/settling"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export type ReviewCountsScope = {
  locationId?: string
  clientId?: string
}

export function useReviewCounts(scope: ReviewCountsScope = {}) {
  return useQuery({
    queryKey: queryKeys.reviewCountsFor(scope),
    queryFn: (ctx) => fetchReviewCounts(scope, requestOptions(ctx)),
    // The rail's badges count the same rows the list polls, so they follow the
    // same rule: while anything is still on its way to Google, keep asking.
    // Without this the "Publishing" badge kept its number after the row it
    // counted had already settled in the pane beside it.
    refetchInterval: (query) =>
      settlingInterval(
        Object.entries(query.state.data?.byStatus ?? {}).flatMap(
          ([status, count]) => (count > 0 ? [status] : [])
        ),
        query
      ),
  })
}
