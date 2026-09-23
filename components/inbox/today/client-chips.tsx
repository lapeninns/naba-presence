"use client"

import { ChipCount, ChipRow, chipClassName } from "@/components/ui/chip"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { healthLabel, healthTone } from "@/lib/clients/health"
import type { ClientSummary } from "@/lib/contracts/clients"
import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

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
 * Who needs you today, by client (reference `.client-chip`): one chip per
 * client, busiest first, each a scope for the list beneath. Press a client
 * and the list narrows to it; press again to see everything. The chip is
 * the client's health dot, its name and its open count in mono. Pressed
 * fills with ink, like every chip.
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
            className="h-8 w-32 rounded-(--np-radius-pill) pointer-coarse:h-10"
          />
        ))}
      </div>
    )
  }

  return (
    <ChipRow role="group" aria-label="Work by client">
      {rows.map((row) => {
        const pressed = row.id === selectedId
        return (
          <button
            key={row.id}
            type="button"
            aria-pressed={pressed}
            data-slot="chip"
            data-pressed={pressed || undefined}
            aria-label={`${row.name}, ${healthLabel(row.health)}, ${
              row.open === 1 ? "1 open item" : `${row.open} open items`
            }`}
            onClick={() => onSelect(pressed ? undefined : row.id)}
            className={chipClassName({ pressed })}
          >
            <StatusPill
              variant="dot"
              tone={healthTone(row.health)}
              className={cn("size-[7px]", pressed && "ring-1 ring-canvas")}
            />
            <span className="max-w-[18ch] truncate">{row.name}</span>
            <ChipCount>{formatNumber(row.open)}</ChipCount>
          </button>
        )
      })}
    </ChipRow>
  )
}

export { ClientChips, clientChipRows }
