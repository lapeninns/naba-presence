"use client"

import * as React from "react"

import { ChipRow, ToggleChip } from "@/components/ui/chip"
import {
  HEALTH_FILTERS,
  healthBucket,
  type ClientHealth,
  type HealthBucket,
  type HealthFilter,
} from "@/lib/clients/health"
import { formatNumber } from "@/lib/format"

/**
 * How many clients sit in each `?health=` bucket, plus `all`. Counted with
 * `healthBucket`, the same function the list filters with, so every client is
 * in exactly one bucket and the bucket counts add up to `all`.
 */
export function healthCounts(
  clients: readonly { health: ClientHealth }[]
): Record<HealthFilter, number> {
  const counts = Object.fromEntries(
    HEALTH_FILTERS.map((filter) => [filter.value, 0])
  ) as Record<HealthFilter, number>
  for (const client of clients) counts[healthBucket(client.health)] += 1
  counts.all = clients.length
  return counts
}

/** Buckets whose count is drawn in the danger ink when anyone is in them. */
const ALERT_BUCKETS: ReadonlySet<HealthBucket> = new Set([
  "disconnected",
  "attention",
])

/**
 * The Clients list's one health filter: "All" and every bucket, each with
 * its count, as a sideways-scrolling chip strip. A chip is never truncated;
 * the strip fades at whichever edge has more chips beyond it, and the chosen
 * chip is scrolled into view when it changes (and on load, for a shared
 * `?health=` link).
 */
export function HealthFilterStrip({
  value,
  counts,
  onValueChange,
}: {
  value: HealthFilter
  counts: Record<HealthFilter, number>
  onValueChange: (next: HealthFilter) => void
}) {
  const rowRef = React.useRef<HTMLDivElement>(null)
  const [fade, setFade] = React.useState({ start: false, end: false })

  const measure = React.useCallback(() => {
    const row = rowRef.current
    if (!row) return
    const start = row.scrollLeft > 1
    const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 1
    setFade((current) =>
      current.start === start && current.end === end ? current : { start, end }
    )
  }, [])

  React.useEffect(() => {
    const row = rowRef.current
    if (!row) return
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    return () => observer.disconnect()
  }, [measure])

  // Keep the chosen chip in view: sideways only, so a filter change never
  // moves the page itself.
  React.useEffect(() => {
    const row = rowRef.current
    const chip = row?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!row || !chip) return
    const rowBox = row.getBoundingClientRect()
    const chipBox = chip.getBoundingClientRect()
    const gutter = 24
    if (chipBox.left < rowBox.left) {
      row.scrollLeft -= rowBox.left - chipBox.left + gutter
    } else if (chipBox.right > rowBox.right) {
      row.scrollLeft += chipBox.right - rowBox.right + gutter
    }
    measure()
  }, [value, measure])

  return (
    <ChipRow
      ref={rowRef}
      role="group"
      aria-label="Filter by health"
      onScroll={measure}
      data-fade-start={fade.start || undefined}
      data-fade-end={fade.end || undefined}
      className="data-fade-end:mask-r-from-85% data-fade-start:mask-l-from-85%"
    >
      {HEALTH_FILTERS.map((filter) => {
        const count = counts[filter.value]
        const pressed = value === filter.value
        return (
          <ToggleChip
            key={filter.value}
            pressed={pressed}
            count={formatNumber(count)}
            countTone={
              filter.value !== "all" &&
              ALERT_BUCKETS.has(filter.value) &&
              count > 0
                ? "alert"
                : "default"
            }
            // Pressing the chosen bucket again goes back to All.
            onClick={() =>
              onValueChange(
                pressed && filter.value !== "all" ? "all" : filter.value
              )
            }
          >
            {filter.label}
          </ToggleChip>
        )
      })}
    </ChipRow>
  )
}
