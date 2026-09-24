"use client"

import { useClientScope } from "@/components/app-shell/client-context"
import { formatRelativeTime } from "@/lib/format"
import { useClients } from "@/lib/queries/use-clients"
import { cn } from "@/lib/utils"

/**
 * How current the reviews behind this inbox are at Google's end: the
 * least recently checked listing in scope, from successful checks only.
 * "Refreshed" beside it says when this page last fetched from NabaPresence;
 * this says when NabaPresence last heard from Google, which is what decides
 * whether a new review could be missing.
 */
export function GoogleFreshness() {
  const clientId = useClientScope()
  const clients = useClients()
  const inScope = (clients.data?.items ?? []).filter(
    (client) => (!clientId || client.id === clientId) && client.linkedCount > 0
  )
  const freshness = inScope.flatMap((client) =>
    client.freshness ? [client.freshness] : []
  )
  if (freshness.length === 0) return null
  const delayed = freshness.some((entry) => entry.state === "data_delayed")
  const oldest = freshness
    .map((entry) => entry.lastSuccessfulCheckAt)
    .filter((at): at is string => Boolean(at))
    .sort()[0]
  return (
    <span
      className={cn(
        "font-mono text-[11.5px] tabular-nums",
        delayed ? "text-warning-ink" : "text-ink-muted"
      )}
      title="When NabaPresence last successfully checked these listings' reviews with Google."
    >
      {oldest ? `Google checked ${formatRelativeTime(oldest)}` : "Google not checked yet"}
      {delayed ? " · delayed, retrying" : ""}
    </span>
  )
}
