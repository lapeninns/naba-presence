"use client"

import { ToggleChip } from "@/components/ui/chip"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { healthLabel, healthTone } from "@/lib/clients/health"
import type { ClientSummary } from "@/lib/contracts/clients"
import { formatNumber } from "@/lib/format"

export type ClientChipRow = Pick<ClientSummary, "id" | "name" | "health"> & {
  open: number
}

/** Open work per client, busiest first: the point of the row is what next. */
function clientChipRows(clients: ClientSummary[] | undefined): ClientChipRow[] {
  return (clients ?? [])
    .map((client) => ({
      id: client.id,
      name: client.name,
      health: client.health,
      open:
        client.openWork.needsReply +
        client.openWork.awaitingApproval +
        client.openWork.failed,
    }))
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name))
}

/**
 * Who needs you today, by client — as a row of filters.
 *
 * Home used to answer this with a table whose every count linked into the
 * Inbox. Here the Inbox IS the page, so the same row is a scope: press a
 * client and the list beneath narrows to it, press again to see everything.
 */
function ClientChips({
  rows,
  isPending,
  selectedId,
  onSelect,
}: {
  rows: ClientChipRow[]
  isPending?: boolean
  selectedId?: string
  onSelect: (clientId: string | undefined) => void
}) {
  if (isPending) {
    return (
      <div aria-busy="true" className="flex items-center gap-2">
        {[0, 1, 2].map((index) => (
          <Skeleton
            key={index}
            className="h-7 w-32 rounded-(--np-radius-pill)"
          />
        ))}
      </div>
    )
  }

  return (
    <div
      role="group"
      aria-label="Work by client"
      className="flex items-center gap-2"
    >
      {rows.map((row) => {
        const pressed = row.id === selectedId
        return (
          <ToggleChip
            key={row.id}
            pressed={pressed}
            aria-label={`${row.name}, ${healthLabel(row.health)}, ${
              row.open === 1 ? "1 open item" : `${row.open} open items`
            }`}
            onClick={() => onSelect(pressed ? undefined : row.id)}
          >
            <StatusPill
              variant="dot"
              tone={healthTone(row.health)}
              className={pressed ? "bg-primary-foreground!" : undefined}
            />
            <span className="truncate">{row.name}</span>
            <span
              className={
                pressed
                  ? "text-primary-foreground/80 tabular-nums"
                  : "text-ink-muted tabular-nums"
              }
            >
              {formatNumber(row.open)}
            </span>
          </ToggleChip>
        )
      })}
    </div>
  )
}

export { ClientChips, clientChipRows }
