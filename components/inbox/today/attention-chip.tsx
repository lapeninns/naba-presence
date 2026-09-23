"use client"

import { ChevronRightIcon, TriangleAlertIcon } from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { chipClassName } from "@/components/ui/chip"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { StatusPill } from "@/components/ui/status-pill"
import type { AnalyticsLocation } from "@/lib/api/analytics"
import { formatNumber } from "@/lib/format"

const MAX_ROWS = 5

/** The worst five: 1–2 star reviews with no published reply, last 30 days. */
function attentionRows(
  locations: AnalyticsLocation[] | undefined
): AnalyticsLocation[] {
  return [...(locations ?? [])]
    .filter((location) => location.unresolvedComplaints > 0)
    .sort((a, b) => b.unresolvedComplaints - a.unresolvedComplaints)
    .slice(0, MAX_ROWS)
}

function attentionLabel(total: number): string {
  return total === 1
    ? "1 location needs attention"
    : `${formatNumber(total)} locations need attention`
}

/**
 * Locations needing attention, folded to one chip that opens on demand
 * (reference `attention-pop`). Each row of the popover lands on that
 * location's unresolved 1–2 star reviews.
 */
function AttentionChip({
  rows,
  total,
  onNavigate,
  className,
}: {
  rows: AnalyticsLocation[]
  /** How many locations qualify in all, which may exceed the rows shown. */
  total: number
  onNavigate?: () => void
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  if (rows.length === 0) return null
  const label = attentionLabel(total)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-slot="chip"
            className={chipClassName({ className })}
          />
        }
      >
        <TriangleAlertIcon
          aria-hidden
          strokeWidth={1.75}
          className="text-warning-ink"
        />
        {label}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-24px))]">
        <div className="flex flex-col gap-1">
          <PopoverTitle className="text-ui font-semibold text-ink">
            Unresolved low ratings
          </PopoverTitle>
          <PopoverDescription className="text-caption text-ink-muted">
            1–2 star reviews with no published reply · last 30 days. Worst
            first; each opens the inbox filtered to that location.
          </PopoverDescription>
        </div>
        <ul className="mt-3">
          {rows.map((location) => (
            <li key={location.id} className="border-t border-line">
              <Link
                href={`/inbox?locationId=${location.id}&rating=1,2`}
                prefetch={false}
                onClick={() => {
                  setOpen(false)
                  onNavigate?.()
                }}
                className="-mx-2 flex min-h-11 items-center gap-2.5 rounded-(--np-radius-control) px-2 py-2 text-left focus-halo transition-colors duration-(--np-duration-fast) ease-out-strong hover:bg-surface-alt focus-visible:outline-none"
              >
                <StatusPill variant="dot" tone="at-risk" />
                <span className="min-w-0 flex-1 truncate text-ui font-medium text-ink underline decoration-line-strong underline-offset-2">
                  {location.name}
                </span>
                <span className="shrink-0 font-mono text-caption text-ink-muted tabular-nums">
                  {`${formatNumber(location.unresolvedComplaints)} unresolved`}
                </span>
                <ChevronRightIcon
                  aria-hidden
                  strokeWidth={1.75}
                  className="size-4 shrink-0 text-ink-muted"
                />
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export { AttentionChip, attentionLabel, attentionRows }
