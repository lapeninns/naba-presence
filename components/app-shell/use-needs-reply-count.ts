"use client"

import { useQuery } from "@tanstack/react-query"

import { useRememberedClient } from "@/components/app-shell/client-context"
import { fetchReviewCounts } from "@/lib/api/review-counts"
import { queryKeys } from "@/lib/queries/keys"
import { SEEDED_BY_SHELL, SHELL_POLL_MS } from "@/lib/queries/use-shell-status"
import { useWorkspaceMode } from "@/lib/workspace/mode"

/**
 * The Inbox's needs-reply count for the navigation badges (tab bar, rail,
 * sidebar).
 *
 * It follows the client scope, so the badge and the Inbox title (which
 * counts the scoped Needs reply queue) never disagree: with a client
 * remembered it reads that client's `/api/reviews/counts`, under the key the
 * Inbox's own queue controls use for the same scope; with none (and always
 * in a business, which has no client scope) it reads the organisation-wide
 * count the dashboard layout hydrates and the shell's one poll refreshes
 * (useShellStatus). The poll seeds only the organisation key, so a scoped
 * badge polls on the same beat itself. Always a background request: a badge
 * is not worth a sign-in redirect, so a 401 here just leaves the badge off.
 * `enabled` waits for the session bootstrap (see AppShell's useSessionReady).
 */
export function useNeedsReplyCount(enabled = true): number | undefined {
  const { remembered } = useRememberedClient()
  const business = useWorkspaceMode() === "business"
  const clientId = business ? undefined : (remembered ?? undefined)
  const counts = useQuery({
    enabled,
    queryKey: queryKeys.reviewCountsFor({ clientId }),
    queryFn: ({ signal }) =>
      fetchReviewCounts({ clientId }, { signal, background: true }),
    ...SEEDED_BY_SHELL,
    refetchInterval: clientId ? SHELL_POLL_MS : false,
    retry: false,
  })
  return counts.data?.byQueue.needs_reply
}

/** "Inbox, 2 need a reply": the tab's name carries the count. */
export function inboxName(needsReply: number | undefined) {
  if (!needsReply) return "Inbox"
  return `Inbox, ${needsReply} ${needsReply === 1 ? "needs" : "need"} a reply`
}
