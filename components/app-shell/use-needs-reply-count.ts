"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchReviewCounts } from "@/lib/api/review-counts"
import { queryKeys } from "@/lib/queries/keys"

/**
 * The Inbox's needs-reply count for the navigation badges (tab bar, rail,
 * sidebar).
 *
 * The same organisation-wide `/api/reviews/counts` read the Inbox's queue
 * controls make, under the same key, so the badge and the Needs reply queue
 * never disagree and every badge shares one 60s poll. Always a background
 * request: a badge is not worth a sign-in redirect, so a 401 here just
 * leaves the badge off. `enabled` waits for the session bootstrap (see
 * AppShell's useSessionReady).
 */
export function useNeedsReplyCount(enabled = true): number | undefined {
  const counts = useQuery({
    enabled,
    queryKey: queryKeys.reviewCounts("organisation"),
    queryFn: ({ signal }) =>
      fetchReviewCounts({}, { signal, background: true }),
    refetchInterval: 60_000,
    retry: false,
  })
  return counts.data?.byQueue.needs_reply
}

/** "Inbox, 2 need a reply": the tab's name carries the count. */
export function inboxName(needsReply: number | undefined) {
  if (!needsReply) return "Inbox"
  return `Inbox, ${needsReply} ${needsReply === 1 ? "needs" : "need"} a reply`
}
