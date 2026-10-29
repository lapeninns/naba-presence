"use client"

import { FilterChip, FilterChipStrip } from "@/components/ui/chip"
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
 * The Clients list's one health filter: "All" and the buckets that have
 * clients in them, each with its count, on the shared filter chip (the
 * Listings board's strip). A bucket with no clients is not drawn, unless it
 * is the one chosen (an old `?health=` link keeps its chip, so the filter
 * never vanishes from under the reader). A phone scrolls the strip sideways
 * with an edge fade; from `md` the chips wrap, so none is ever clipped.
 * The chips keep `HEALTH_FILTERS`' severity order and are never re-sorted by
 * count (why: the comment on `HEALTH_FILTERS`).
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
  return (
    <FilterChipStrip
      role="group"
      aria-label="Filter by health"
      // Full bleed on a phone: the strip runs to the screen edges and its
      // first chip lines up with the page gutter. From md it wraps; the row
      // gap leaves room for the 44px touch extension of each chip.
      className="max-md:-mx-5 max-md:scroll-px-5 max-md:px-5 md:flex-wrap md:gap-y-4 desk:gap-y-1.5"
    >
      {HEALTH_FILTERS.map((filter) => {
        const count = counts[filter.value]
        const pressed = value === filter.value
        return (
          <FilterChip
            key={filter.value}
            pressed={pressed}
            count={formatNumber(count)}
            hideWhenZero={filter.value !== "all"}
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
          </FilterChip>
        )
      })}
    </FilterChipStrip>
  )
}
