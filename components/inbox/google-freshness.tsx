"use client"

import { useClientScope } from "@/components/app-shell/client-context"
import { RelativeTime } from "@/components/ui/relative-time"
import type { FreshnessReason } from "@/lib/clients/health"
import { useClients } from "@/lib/queries/use-clients"
import { cn } from "@/lib/utils"

/**
 * What a person must do before checks can resume, in the words of the
 * freshness sentences (`freshnessSentence`), short enough for the header.
 */
const BLOCKED_WORDS: Partial<Record<FreshnessReason, string>> = {
  reconnect_required: "reconnect needed",
  listing_access_lost: "listing access lost",
  permission_missing: "permission needed",
}

/**
 * How current the reviews behind this inbox are at Google's end: the
 * least recently checked listing in scope, from successful checks only.
 * "Refreshed" beside it says when this page last fetched from NabaPresence;
 * this says when NabaPresence last heard from Google, which is what decides
 * whether a new review could be missing. The words say so on their own
 * ("Google checked 5 min ago"); there is no hover title to explain them,
 * which a touch screen could never show. A listing a person has to act on
 * (a login to reconnect, lost access, a missing permission) is named after
 * it, worst first, as is a delay the platform is retrying: for anyone who
 * cannot sync, this line is the only sign the list will not refresh.
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
  const blocked = freshness.find((entry) => entry.state === "action_needed")
  const delayed = freshness.some((entry) => entry.state === "data_delayed")
  const suffix = blocked
    ? ` · ${(blocked.reason && BLOCKED_WORDS[blocked.reason]) ?? "needs attention"}`
    : delayed
      ? " · delayed, retrying"
      : ""
  const oldest = freshness
    .map((entry) => entry.lastSuccessfulCheckAt)
    .filter((at): at is string => Boolean(at))
    .sort()[0]
  return (
    <span
      className={cn(
        "text-caption tabular-nums",
        blocked || delayed ? "text-warning-ink" : "text-ink-muted",
        // The caller's layout (truncation, where it steps aside) applies to
        // the warning too: a delay or a block is drawn in the warning ink
        // but is not allowed to overflow a header that has no room for it.
        className
      )}
    >
      {oldest ? (
        <RelativeTime
          iso={oldest}
          prefix="Google checked "
          casing="mid-sentence"
        />
      ) : (
        "Google not checked yet"
      )}
      {suffix}
    </span>
  )
}
