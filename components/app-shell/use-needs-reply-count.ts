"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchReviewCounts } from "@/lib/api/review-counts"
import { queryKeys } from "@/lib/queries/keys"
import { SEEDED_BY_SHELL } from "@/lib/queries/use-shell-status"

/**
 * The Inbox's needs-reply count for the navigation badges (tab bar, rail,
 * sidebar).
 *
 * The same organisation-wide `/api/reviews/counts` read the Inbox's queue
 * controls make, under the same key, so the badge and the Needs reply queue
 * never disagree. The shell's one poll refreshes it (useShellStatus); this
 * read covers the first load and invalidations. Always a background
 * request: a badge is not worth a sign-in redirect, so a 401 here just
 * leaves the badge off. `enabled` waits for the session bootstrap (see
 * AppShell's useSessionReady).
 */
export function useNeedsReplyCount(enabled = true): number | undefined {
  const counts = useQuery({
    enabled,
    queryKey: queryKeys.reviewCountsFor(),
    queryFn: ({ signal }) =>
      fetchReviewCounts({}, { signal, background: true }),
    ...SEEDED_BY_SHELL,
    retry: false,
  })
  return counts.data?.byQueue.needs_reply
}

/** "Inbox, 2 need a reply": the tab's name carries the count. */
export function inboxName(needsReply: number | undefined) {
  if (!needsReply) return "Inbox"
  return `Inbox, ${needsReply} ${needsReply === 1 ? "needs" : "need"} a reply`
}
