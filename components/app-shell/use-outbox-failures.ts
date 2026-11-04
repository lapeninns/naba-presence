"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchOutboxCounts } from "@/lib/outbox/api"
import { outboxKeys } from "@/lib/outbox/keys"
import { SHELL_POLL_MS } from "@/lib/queries/use-shell-status"

/**
 * How many of this person's sends failed, for the Outbox row's alert in
 * the sidebar, the rail and the More sheet (SYSTEM §10: the Outbox shows
 * failures only). Organisation-wide, like the Outbox link itself, under
 * the key the Outbox page reads for the same unscoped view, so the two
 * never disagree. A background request on the shell's beat: a badge is
 * not worth a sign-in redirect, so a refusal just leaves it off.
 * `enabled` is false for anyone without an Outbox (viewers) and until the
 * session is ready.
 */
export function useOutboxFailures(enabled: boolean): number | undefined {
  const counts = useQuery({
    enabled,
    queryKey: outboxKeys.counts({}),
    queryFn: ({ signal }) =>
      fetchOutboxCounts({}, { signal, background: true }),
    refetchInterval: SHELL_POLL_MS,
    retry: false,
  })
  return enabled ? counts.data?.failed : undefined
}

/** "2 failed": the description the Outbox row carries for its alert. */
export function outboxFailuresPhrase(count: number) {
  return `${count} failed`
}
