"use client"

import { HomeSection } from "@/components/home/home-section"
import { KpiTile } from "@/components/ui/kpi-tile"
import { Skeleton } from "@/components/ui/skeleton"
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
    <HomeSection
      id={HEADING_ID}
      title="Health"
      description="Last 30 days on Google — replies and ratings from reviews created in this window."
    >
      {isPending || !summary ? (
        <div
          aria-busy="true"
          className="grid gap-(--np-gap-card) sm:grid-cols-2 xl:grid-cols-4"
        >
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-28 rounded-(--np-radius-card)" />
          ))}
        </div>
      ) : (
        <div className="grid gap-(--np-gap-card) sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile
            label="Reviews received"
            value={formatNumber(summary.reviewVolume)}
            hint="Created in the last 30 days"
          />
          <KpiTile
            label="Average rating"
            value={
              summary.averageRating === null
                ? "—"
                : summary.averageRating.toFixed(1)
            }
            hint="Out of 5"
          />
          <KpiTile
            label="Response rate"
            value={
              summary.responseRate === null
                ? "—"
                : formatPercent(summary.responseRate)
            }
            hint="Published or accepted replies"
          />
          <KpiTile
            label="Median response time"
            value={formatDuration(summary.medianFirstResponseSeconds)}
            hint="First reply, last 30 days"
          />
        </div>
      )}
    </HomeSection>
  )
}

export { HealthKpis }
