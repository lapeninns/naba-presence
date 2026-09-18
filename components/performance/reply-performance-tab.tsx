"use client"

import { useMemo, useState } from "react"

import {
  ChartCard,
  ReportingAreaChart,
  ReportingBarChart,
} from "@/components/ui/chart"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { KpiTile } from "@/components/ui/kpi-tile"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { DivergenceBanner } from "@/components/reporting/divergence-banner"
import { kpiDelta } from "@/components/reporting/delta-badge"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { RangeSelect } from "@/components/performance/range-select"
import { ReplyLocationsTable } from "@/components/performance/reply-locations-table"
import {
  REPLY_RANGES,
  resolveReplyRange,
  type ReplyRangeId,
} from "@/lib/reporting/ranges"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"
import {
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
} from "@/lib/format"

function ReplyPerformanceLoading() {
  return (
    <div
      aria-busy="true"
      role="status"
      className="flex flex-col gap-(--np-gap-section)"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-ui text-ink-muted">
          <Spinner decorative size="sm" className="shrink-0" />
          Loading reply performance…
        </p>
        <Skeleton className="h-(--np-field-h) w-36 rounded-(--np-radius-control)" />
      </div>

      <div className="grid gap-(--np-gap-card) sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className="flex min-h-28 flex-col gap-2 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)"
          >
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="mt-auto h-3 w-28" />
          </div>
        ))}
      </div>

      <div className="grid gap-(--np-gap-card) lg:grid-cols-2">
        {[0, 1].map((item) => (
          <div
            key={item}
            className="flex flex-col gap-4 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)"
          >
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-52 w-full rounded-(--np-radius-control)" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function ReplyPerformanceTab({ clientId }: { clientId?: string }) {
  const [rangeId, setRangeId] = useState<ReplyRangeId>("30d")
  // Memoise the range: resolveReplyRange defaults `now` to `new Date()`, so
  // calling it in the render body minted fresh from/to ISO strings every render
  // -> a new useAnalyticsOverview query key -> refetch -> re-render -> an
  // infinite fetch loop (72 requests in 5s, observed). Capture the window once
  // per rangeId change so the query keys stay stable.
  const { current, previous } = useMemo(
    () => resolveReplyRange(rangeId),
    [rangeId]
  )
  const now = useAnalyticsOverview({ ...current, clientId })
  const prior = useAnalyticsOverview({ ...previous, clientId })

  if (now.isPending) return <ReplyPerformanceLoading />
  if (now.isError)
    return <ReportingPanel variant="error" onRetry={() => void now.refetch()} />

  const s = now.data.summary
  const p = prior.data?.summary ?? null
  const timezone = now.data.timezone
  const tick = (iso: string) => formatDate(iso, timezone)
  const hasSeries = now.data.series.some((point) => point.reviewCount > 0)

  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      {/* Leading h2 keeps the heading order valid: page h1 -> tab h2 -> card h3 (REV-2). */}
      <h2 className="sr-only">Reply performance</h2>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FetchedAtCaption iso={now.data.to} timezone={timezone} />
        <RangeSelect
          value={rangeId}
          onChange={setRangeId}
          options={REPLY_RANGES}
          label="Reply performance range"
        />
      </div>

      <DivergenceBanner providerTotals={now.data.providerTotals} />

      {/* Deltas compare against the equal-length window before this one. A
          missing comparison draws nothing rather than a made-up zero. */}
      <div className="grid gap-(--np-gap-card) sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Reviews"
          value={formatNumber(s.reviewVolume)}
          delta={kpiDelta(s.reviewVolume, p?.reviewVolume ?? null, "count")}
        />
        <KpiTile
          label="Average rating"
          value={s.averageRating === null ? "—" : s.averageRating.toFixed(1)}
          delta={kpiDelta(s.averageRating, p?.averageRating ?? null, "rating")}
        />
        <KpiTile
          label="Response rate"
          value={s.responseRate === null ? "—" : formatPercent(s.responseRate)}
          delta={kpiDelta(s.responseRate, p?.responseRate ?? null, "percent")}
        />
        {/* Duration-typed delta (REV-4): renders "▼ −20m" (faster), never raw seconds. */}
        <KpiTile
          label="Median response time"
          value={formatDuration(s.medianFirstResponseSeconds)}
          delta={kpiDelta(
            s.medianFirstResponseSeconds,
            p?.medianFirstResponseSeconds ?? null,
            "duration"
          )}
        />
      </div>

      <div className="grid gap-(--np-gap-card) lg:grid-cols-2">
        <ChartCard
          title="Review volume"
          state={hasSeries ? "ready" : "empty"}
          emptyLabel="No reviews in this window."
        >
          <ReportingBarChart
            data={now.data.series}
            xKey="period"
            xTickFormatter={tick}
            series={[
              { key: "reviewCount", label: "Reviews", colorVar: 1 },
              { key: "replies", label: "Replies", colorVar: 4 },
            ]}
          />
        </ChartCard>
        <ChartCard
          title="Average rating over time"
          state={hasSeries ? "ready" : "empty"}
          emptyLabel="No rated reviews in this window."
        >
          <ReportingAreaChart
            data={now.data.series}
            xKey="period"
            xTickFormatter={tick}
            series={[
              { key: "averageRating", label: "Daily average", colorVar: 3 },
            ]}
          />
        </ChartCard>
      </div>

      {/* Only meaningful as a comparison. For a single-location org the table
          would be one row restating the stat tiles directly above it, and at
          zero it would be an empty panel saying what those tiles already say.
          Derived from the data rather than a prop, so it reappears on its own
          the moment a second location is added. */}
      {now.data.locations.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>By location</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <ReplyLocationsTable locations={now.data.locations} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
