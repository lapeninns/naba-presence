"use client"

import {
  AttentionChip,
  attentionRows,
} from "@/components/inbox/today/attention-chip"
import {
  ClientChips,
  clientChipRows,
} from "@/components/inbox/today/client-chips"
import {
  SetupNudgeChip,
  useSetupNudge,
} from "@/components/inbox/today/setup-nudge"
import { Skeleton } from "@/components/ui/skeleton"
import type { ReviewCounts } from "@/lib/contracts/reviews"
import { formatNumber } from "@/lib/format"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"
import { useClients } from "@/lib/queries/use-clients"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"

/**
 * Today, above the queues (reference `.today`): how much work waits and for
 * whom, in one wrapping row.
 *
 * First the summary tile on the accent tint — the count of reviews needing a
 * reply, in mono, and how many clients they belong to. Beside it one chip per
 * client, busiest first, each a scope for the list. Then the two nudges as
 * chips: the locations that need attention, and the first client's
 * unfinished setup. Each part disappears when it has nothing to add, and
 * when a single-client agency is caught up the strip renders nothing at all.
 *
 * Every figure is read from the app: the queue counts, the client summaries
 * and the analytics overview. Nothing here is a sample.
 */
function TodayStrip({
  clientId,
  counts,
  countsPending,
  onClientChange,
  className,
}: {
  clientId?: string
  counts?: ReviewCounts
  countsPending?: boolean
  onClientChange: (clientId: string | undefined) => void
  className?: string
}) {
  const role = useSessionRole()
  const clients = useClients()
  const analytics = useAnalyticsOverview()
  const nudge = useSetupNudge(role)

  const items = clients.data?.items ?? []
  const rows = clientChipRows(items)
  const showClients = clients.isPending || rows.length > 1
  const qualifying = (analytics.data?.locations ?? []).filter(
    (location) => location.unresolvedComplaints > 0
  )
  const attention = attentionRows(qualifying)
  const needsReply = counts?.byQueue?.needs_reply ?? 0
  const showSummary = Boolean(countsPending) || needsReply > 0 || showClients

  if (!nudge && !showClients && attention.length === 0 && needsReply === 0) {
    return null
  }

  // "across N clients" counts the clients that actually have a review
  // waiting, not every client on the books.
  const waitingClients = items.filter(
    (client) => client.openWork.needsReply > 0
  ).length

  return (
    <section
      aria-label="Today"
      data-slot="inbox-today"
      className={cn("flex shrink-0 flex-wrap items-stretch gap-3", className)}
    >
      {showSummary ? (
        <div
          data-slot="today-summary"
          className="flex min-w-[170px] flex-col justify-center gap-0.5 rounded-(--np-radius-card) bg-accent-tint px-4 py-2.5 text-accent-ink max-sm:flex-1"
        >
          {countsPending ? (
            <>
              <Skeleton className="h-7 w-10" />
              <Skeleton className="h-3.5 w-32" />
            </>
          ) : (
            <>
              <span className="font-mono text-2xl leading-7 font-semibold tabular-nums">
                {formatNumber(needsReply)}
              </span>
              <span className="text-[12.5px] leading-4 font-medium">
                {needsReply === 1 ? "needs a reply" : "need a reply"}
                {waitingClients > 0
                  ? ` · ${formatNumber(waitingClients)} ${
                      waitingClients === 1 ? "client" : "clients"
                    }`
                  : ""}
              </span>
            </>
          )}
        </div>
      ) : null}

      {showClients ? (
        <div className="flex min-w-0 flex-[1_1_320px] items-center">
          <ClientChips
            rows={rows}
            isPending={clients.isPending}
            selectedId={clientId}
            onSelect={onClientChange}
          />
        </div>
      ) : null}

      {attention.length > 0 || nudge ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <AttentionChip rows={attention} total={qualifying.length} />
          {nudge ? <SetupNudgeChip nudge={nudge} /> : null}
        </div>
      ) : null}
    </section>
  )
}

export { TodayStrip }
