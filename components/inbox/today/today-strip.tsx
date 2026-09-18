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
  SetupNudgeCard,
  useSetupNudge,
} from "@/components/inbox/today/setup-nudge"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"
import { useClients } from "@/lib/queries/use-clients"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"

/**
 * What Home used to say, said at the top of the Inbox.
 *
 * Three things, each of which disappears when it has nothing to add: the
 * first client's unfinished setup, the agency's clients as a row of scopes
 * (only once there are two — one chip would be a label), and the locations
 * with unanswered low ratings. When all three are silent the strip renders
 * nothing at all, so a caught-up single-client agency sees the plain inbox.
 */
function TodayStrip({
  clientId,
  onClientChange,
  className,
}: {
  clientId?: string
  onClientChange: (clientId: string | undefined) => void
  className?: string
}) {
  const role = useSessionRole()
  const clients = useClients()
  const analytics = useAnalyticsOverview()
  const nudge = useSetupNudge(role)

  const rows = clientChipRows(clients.data?.items)
  const showClients = clients.isPending || rows.length > 1
  const qualifying = (analytics.data?.locations ?? []).filter(
    (location) => location.unresolvedComplaints > 0
  )
  const attention = attentionRows(qualifying)

  if (!nudge && !showClients && attention.length === 0) return null

  return (
    <section
      aria-label="Today"
      data-slot="inbox-today"
      className={cn("flex shrink-0 flex-col gap-3", className)}
    >
      {nudge ? <SetupNudgeCard nudge={nudge} /> : null}
      {showClients || attention.length > 0 ? (
        // One row: the client scopes scroll sideways on a phone rather than
        // wrapping into a second block above the reviews.
        <div className="-mx-5 flex items-center gap-2 overflow-x-auto px-5 py-0.5 md:-mx-(--np-page-pad-x) md:px-(--np-page-pad-x)">
          {showClients ? (
            <ClientChips
              rows={rows}
              isPending={clients.isPending}
              selectedId={clientId}
              onSelect={onClientChange}
            />
          ) : null}
          <AttentionChip rows={attention} total={qualifying.length} />
        </div>
      ) : null}
    </section>
  )
}

export { TodayStrip }
