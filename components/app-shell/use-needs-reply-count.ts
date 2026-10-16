"use client"

import { useQuery } from "@tanstack/react-query"
import { usePathname, useSearchParams } from "next/navigation"

import { useRememberedClient } from "@/components/app-shell/client-context"
import { fetchReviewCounts } from "@/lib/api/review-counts"
import { clientPageKind, isClientIdToken } from "@/lib/clients/scope"
import {
  inboxWaiting,
  type InboxWaiting,
  waitingPhrase,
} from "@/lib/inbox/waiting"
import { queryKeys } from "@/lib/queries/keys"
import { SEEDED_BY_SHELL, SHELL_POLL_MS } from "@/lib/queries/use-shell-status"
import { useWorkspaceMode } from "@/lib/workspace/mode"

/**
 * What the Inbox has waiting on this person, for the navigation badges (tab
 * bar, rail, sidebar): reviews that need a reply plus replies awaiting their
 * approval (R03), so an approver is called to the Inbox too.
 *
 * It follows the client scope, so the badge and the Inbox title (which
 * counts the same scoped sum) never disagree. On the pages whose
 * `?clientId=` is the scope (Inbox, Listings, Reports) the scope is the
 * address's, exactly as the Inbox reads it, whatever is remembered; on every
 * other page it is the remembered client. With a client in scope it reads
 * that client's `/api/reviews/counts`, under the key the Inbox's own queue
 * controls use for the same scope; with none (and always in a business,
 * which has no client scope) it reads the organisation-wide count the
 * dashboard layout hydrates and the shell's one poll refreshes
 * (useShellStatus). The poll seeds only the organisation key, so a scoped
 * badge polls on the same beat itself. Always a background request: a badge
 * is not worth a sign-in redirect, so a 401 here just leaves the badge off.
 * `enabled` waits for the session bootstrap (see AppShell's useSessionReady).
 */
export function useInboxWaiting(enabled = true): InboxWaiting | undefined {
  const { remembered } = useRememberedClient()
  const pathname = usePathname()
  const searchClientId = useSearchParams()?.get("clientId") ?? null
  const business = useWorkspaceMode() === "business"
  const scope =
    clientPageKind(pathname) === "scoped"
      ? isClientIdToken(searchClientId)
        ? searchClientId
        : null
      : remembered
  const clientId = business ? undefined : (scope ?? undefined)
  const counts = useQuery({
    enabled,
    queryKey: queryKeys.reviewCountsFor({ clientId }),
    queryFn: ({ signal }) =>
      fetchReviewCounts({ clientId }, { signal, background: true }),
    ...SEEDED_BY_SHELL,
    refetchInterval: clientId ? SHELL_POLL_MS : false,
    retry: false,
  })
  return inboxWaiting(counts.data)
}

/** The badge's number: reviews waiting on this person, replies and approvals. */
export function useNeedsReplyCount(enabled = true): number | undefined {
  return useInboxWaiting(enabled)?.total
}

/** "Inbox, 2 need a reply": the tab's name carries the count. */
export function inboxName(waiting: InboxWaiting | undefined) {
  if (!waiting?.total) return "Inbox"
  return `Inbox, ${waitingPhrase(waiting)}`
}
