"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { StatTile } from "@/components/reporting/stat-tile"
import type { AnalyticsSummary } from "@/lib/api/analytics"
import { formatDuration, formatNumber, formatPercent } from "@/lib/format"

const HEADING_ID = "health-heading"

function HealthKpis({
  summary,
  isPending,
}: {
  summary: AnalyticsSummary | undefined
  isPending?: boolean
}) {
  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id={HEADING_ID} className="text-title font-semibold tracking-tight">
          Health
        </h2>
        <p className="text-caption text-muted-foreground">
          Last 30 days on Google — replies and ratings from reviews created in
          this window.
        </p>
      </div>

      {isPending || !summary ? (
        <div
          aria-busy="true"
          className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4"
        >
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-28 rounded-(--nr-radius-card)" />
          ))}
        </div>
      ) : (
        <div className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Reviews received"
            value={formatNumber(summary.reviewVolume)}
            hint="Created in the last 30 days"
          />
          <StatTile
            label="Average rating"
            value={
              summary.averageRating === null
                ? "—"
                : summary.averageRating.toFixed(1)
            }
          />
          <StatTile
            label="Response rate"
            value={
              summary.responseRate === null
                ? "—"
                : formatPercent(summary.responseRate)
            }
            hint="Published or accepted replies"
          />
          <StatTile
            label="Median response time"
            value={formatDuration(summary.medianFirstResponseSeconds)}
            hint="First reply, last 30 days"
          />
        </div>
      )}
    </section>
  )
}

export { HealthKpis }
