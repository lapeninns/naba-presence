"use client"

import { useState } from "react"

import { ChartCard, ReportingBarChart, ReportingLineChart } from "@/components/ui/chart"
import { Card, CardContent } from "@/components/ui/card"
import { DivergenceBanner } from "@/components/home/divergence-banner"
import { DeltaBadge } from "@/components/reporting/delta-badge"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { StatTile } from "@/components/reporting/stat-tile"
import { RangeSelect } from "@/components/performance/range-select"
import { ReplyLocationsTable } from "@/components/performance/reply-locations-table"
import { REPLY_RANGES, resolveReplyRange, type ReplyRangeId } from "@/lib/reporting/ranges"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"
import { formatDate, formatDuration, formatNumber, formatPercent } from "@/lib/format"

export function ReplyPerformanceTab() {
  const [rangeId, setRangeId] = useState<ReplyRangeId>("30d")
  const { current, previous } = resolveReplyRange(rangeId)
  const now = useAnalyticsOverview(current)
  const prior = useAnalyticsOverview(previous)

  if (now.isPending) return <ReportingPanel variant="loading" />
  if (now.isError) return <ReportingPanel variant="error" onRetry={() => void now.refetch()} />

  const s = now.data.summary
  const p = prior.data?.summary ?? null
  const timezone = now.data.timezone
  const tick = (iso: string) => formatDate(iso, timezone)
  const hasSeries = now.data.series.some((point) => point.reviewCount > 0)

  return (
    <div className="flex flex-col gap-(--nr-gap-section)">
      {/* Leading h2 keeps the heading order valid: page h1 -> tab h2 -> card h3 (REV-2). */}
      <h2 className="sr-only">Reply performance</h2>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FetchedAtCaption iso={now.data.to} timezone={timezone} />
        <RangeSelect value={rangeId} onChange={setRangeId} options={REPLY_RANGES} label="Reply performance range" />
      </div>

      <DivergenceBanner providerTotals={now.data.providerTotals} />

      <div className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Reviews" value={formatNumber(s.reviewVolume)} delta={<DeltaBadge current={s.reviewVolume} previous={p?.reviewVolume ?? null} unit="count" />} />
        <StatTile label="Average rating" value={s.averageRating === null ? "—" : s.averageRating.toFixed(1)} delta={<DeltaBadge current={s.averageRating} previous={p?.averageRating ?? null} unit="rating" />} />
        <StatTile label="Response rate" value={s.responseRate === null ? "—" : formatPercent(s.responseRate)} delta={<DeltaBadge current={s.responseRate} previous={p?.responseRate ?? null} unit="percent" />} />
        {/* Duration-typed delta (REV-4): renders "▼ −20m" (faster), never raw seconds. */}
        <StatTile label="Median response time" value={formatDuration(s.medianFirstResponseSeconds)} delta={<DeltaBadge current={s.medianFirstResponseSeconds} previous={p?.medianFirstResponseSeconds ?? null} unit="duration" />} />
      </div>

      <div className="grid gap-(--nr-gap-card) lg:grid-cols-2">
        <ChartCard title="Review volume" state={hasSeries ? "ready" : "empty"} emptyLabel="No reviews in this window.">
          <ReportingBarChart data={now.data.series} xKey="period" xTickFormatter={tick} series={[{ key: "reviewCount", label: "Reviews", colorVar: 1 }, { key: "replies", label: "Replies", colorVar: 4 }]} />
        </ChartCard>
        <ChartCard title="Average rating over time" state={hasSeries ? "ready" : "empty"} emptyLabel="No rated reviews in this window.">
          <ReportingLineChart data={now.data.series} xKey="period" xTickFormatter={tick} series={[{ key: "averageRating", label: "Daily average", colorVar: 3 }]} />
        </ChartCard>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <h3 className="text-title font-semibold tracking-tight">By location</h3>
          {now.data.locations.length === 0 ? (
            <ReportingPanel variant="empty" description="No location has reviews in this window." />
          ) : (
            <ReplyLocationsTable locations={now.data.locations} timezone={timezone} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
