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
 * whether a new review could be missing. The words say so on their own
 * ("Google checked 5 min ago"); there is no hover title to explain them,
 * which a touch screen could never show.
 */
export function GoogleFreshness({
  clientId: filterClientId,
  className,
}: {
  /** The inbox's client filter, which narrows further than the shell's scope. */
  clientId?: string
  className?: string
}) {
  const shellClientId = useClientScope()
  const clientId = filterClientId ?? shellClientId
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
        "font-mono text-caption tabular-nums",
        delayed ? "text-warning-ink" : "text-ink-muted",
        // A delay is a warning, so it shows wherever the caller would have
        // folded the routine "checked 5 minutes ago" away.
        !delayed && className
      )}
    >
      {oldest
        ? `Google checked ${formatRelativeTime(oldest)}`
        : "Google not checked yet"}
      {delayed ? " · delayed, retrying" : ""}
    </span>
  )
}
