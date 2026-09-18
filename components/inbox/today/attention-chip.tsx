"use client"

import { ChevronRightIcon, TriangleAlertIcon } from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { Button } from "@/components/ui/button"
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

/**
 * Locations needing attention, folded to one chip.
 *
 * Home gave this a whole list. In the Inbox the list would sit above the
 * reviews it points into, so it is a count that opens on demand, and each row
 * still lands on that location's low-rated reviews.
 */
function AttentionChip({
  rows,
  total,
  onNavigate,
}: {
  rows: AnalyticsLocation[]
  /** How many locations qualify in all, which may exceed the rows shown. */
  total: number
  onNavigate?: () => void
}) {
  const [open, setOpen] = React.useState(false)
  if (rows.length === 0) return null
  const label =
    total === 1
      ? "1 location needs attention"
      : `${formatNumber(total)} locations need attention`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="secondary"
            size="sm"
            pill
            className="text-danger-ink"
          />
        }
      >
        <TriangleAlertIcon
          aria-hidden
          strokeWidth={1.75}
          data-icon="inline-start"
        />
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0" showArrow={false}>
        <div className="flex flex-col gap-0.5 px-(--np-card-pad) pt-3 pb-2">
          <PopoverTitle className="text-ui font-semibold text-ink">
            Needs attention
          </PopoverTitle>
          <PopoverDescription className="text-caption text-ink-muted">
            1–2 star reviews with no published reply · last 30 days
          </PopoverDescription>
        </div>
        <ul className="divide-y divide-line-subtle border-t border-line-subtle">
          {rows.map((location) => (
            <li key={location.id}>
              <Link
                href={`/inbox?locationId=${location.id}&rating=1,2`}
                prefetch={false}
                onClick={() => {
                  setOpen(false)
                  onNavigate?.()
                }}
                className="flex min-h-(--np-row-h) w-full items-center gap-3 px-(--np-card-pad) py-2 text-left transition-colors duration-(--np-duration-fast) ease-spring-snappy hover:bg-(--np-hover-bg) focus-visible:[box-shadow:inset_var(--np-focus-halo)] focus-visible:outline-none"
              >
                <StatusPill variant="dot" tone="at-risk" />
                <span className="min-w-0 flex-1 truncate text-ui font-medium text-ink">
                  {location.name}
                </span>
                <span className="shrink-0 text-caption text-ink-muted tabular-nums">
                  {`${formatNumber(location.unresolvedComplaints)} unresolved`}
                </span>
                <ChevronRightIcon
                  aria-hidden
                  strokeWidth={1.75}
                  className="size-4 shrink-0 text-ink-faint"
                />
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export { AttentionChip, attentionRows }
