"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchReviewDetail } from "@/lib/api/reviews"
import { settlingInterval } from "@/lib/inbox/settling"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useReviewDetail(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reviewDetail(id ?? ""),
    queryFn: (ctx) => fetchReviewDetail(id as string, requestOptions(ctx)),
    enabled: Boolean(id),
    // Poll while this reply is still on its way to Google; see lib/inbox/
    // settling.ts for why the pane could otherwise sit on "Publishing" until
    // the operator reloaded the page.
    refetchInterval: (query) =>
      settlingInterval([query.state.data?.review.workflowStatus]),
  })
}
