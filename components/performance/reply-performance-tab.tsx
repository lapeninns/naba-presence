"use client"

import { useMemo, useState } from "react"

import { KpiTile } from "@/components/ui/kpi-tile"
import { SectionHeader } from "@/components/ui/section-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { DivergenceBanner } from "@/components/reporting/divergence-banner"
import { kpiDelta } from "@/components/reporting/delta-badge"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import {
  ReportBarChart,
  ReportChartCard,
} from "@/components/reporting/report-bar-chart"
import {
  ReportTabHead,
  reportTileGridClassName,
} from "@/components/reporting/report-tab-head"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { RangeSelect } from "@/components/performance/range-select"
import { ReplyLocationsTable } from "@/components/performance/reply-locations-table"
import {
  REPLY_RANGES,
  resolveReplyRange,
  type ReplyRangeId,
} from "@/lib/reporting/ranges"
import {
  BIN_HEADING,
  BIN_TOTALS_NOTE,
  formatBinLabel,
} from "@/lib/reporting/series-bins"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"
import { formatDuration, formatNumber, formatPercent } from "@/lib/format"

function ReplyPerformanceLoading() {
  return (
    <div
      aria-busy="true"
      role="status"
      className="flex flex-col gap-(--np-gap-section)"
    >
      <p className="flex items-center gap-2 text-ui text-ink-muted">
        <Spinner decorative size="sm" className="shrink-0" />
        Loading reply performance…
      </p>
      <div className={reportTileGridClassName()}>
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className="flex min-h-28 flex-col gap-2 rounded-(--np-radius-card) border border-line bg-surface p-4"
          >
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="mt-auto h-3 w-28" />
          </div>
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-(--np-radius-card)" />
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
  const unit = current.granularity

  const head = (caption: React.ReactNode) => (
    <ReportTabHead
      caption={caption}
      controls={
        <RangeSelect
          value={rangeId}
          onChange={setRangeId}
          options={REPLY_RANGES}
        />
      }
    />
  )

  if (now.isPending || now.isError) {
    return (
      <div className="@container/report flex flex-col gap-(--np-gap-section)">
        <h2 className="sr-only">Reply performance</h2>
        {/* No "as at" line: there are no figures to date. */}
        {head(null)}
        {now.isPending ? (
          <ReplyPerformanceLoading />
        ) : (
          <ReportingPanel variant="error" onRetry={() => void now.refetch()} />
        )}
      </div>
    )
  }

  const s = now.data.summary
  const p = prior.data?.summary ?? null
  const timezone = now.data.timezone
  const rangeLabel =
    REPLY_RANGES.find((range) => range.id === rangeId)?.label.toLowerCase() ??
    "this window"

  // Nothing in this window: hold the loading state until the comparison
  // window answers, so the page doesn't draw zero tiles and then collapse.
  if (s.reviewVolume === 0 && prior.isPending) {
    return (
      <div className="@container/report flex flex-col gap-(--np-gap-section)">
        <h2 className="sr-only">Reply performance</h2>
        {head(null)}
        <ReplyPerformanceLoading />
      </div>
    )
  }

  // No reviews in this window or the one before it (reference empty state):
  // one panel, not four "—" tiles and two empty charts saying the same thing.
  // When the previous window had reviews the tiles stay, since the drop to
  // zero is itself the finding.
  if (s.reviewVolume === 0 && p?.reviewVolume === 0) {
    return (
      <div className="@container/report flex flex-col gap-(--np-gap-section)">
        <h2 className="sr-only">Reply performance</h2>
        {head(<FetchedAtCaption iso={now.data.to} timezone={timezone} />)}
        <DivergenceBanner providerTotals={now.data.providerTotals} />
        <ReportingPanel
          framed
          variant="empty"
          title="No reviews in this window yet"
          description={`Nothing has been collected for these locations in the ${rangeLabel}. Figures appear here as reviews arrive from Google.`}
        />
      </div>
    )
  }
  const hasSeries = now.data.series.some((point) => point.reviewCount > 0)
  const hasRatings = now.data.series.some(
    (point) => point.averageRating !== null
  )
  const bins = now.data.series.map((point) => ({
    label: formatBinLabel(point.period, unit, timezone),
    values: {
      reviewCount: point.reviewCount,
      replies: point.replies,
      averageRating: point.averageRating,
    },
  }))

  return (
    <div className="@container/report flex flex-col gap-(--np-gap-section)">
      {/* Leading h2 keeps the heading order valid: page h1 -> tab h2 -> card h3 (REV-2). */}
      <h2 className="sr-only">Reply performance</h2>
      {head(<FetchedAtCaption iso={now.data.to} timezone={timezone} />)}

      <DivergenceBanner providerTotals={now.data.providerTotals} />

      {/* Deltas compare against the equal-length window before this one. A
          missing comparison draws nothing rather than a made-up zero. */}
      <div className={reportTileGridClassName()}>
        <KpiTile
          label="Reviews"
          value={formatNumber(s.reviewVolume)}
          delta={kpiDelta(s.reviewVolume, p?.reviewVolume ?? null, "count")}
        />
        <KpiTile
          label="Response rate"
          value={s.responseRate === null ? "—" : formatPercent(s.responseRate)}
          delta={kpiDelta(s.responseRate, p?.responseRate ?? null, "percent")}
          hint="Published or accepted replies"
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
          hint="Review received to first reply"
        />
        <KpiTile
          label="Average rating"
          value={s.averageRating === null ? "—" : s.averageRating.toFixed(1)}
          delta={kpiDelta(s.averageRating, p?.averageRating ?? null, "rating")}
          hint="Out of 5"
        />
      </div>

      <div className="grid grid-cols-1 gap-(--np-gap-card) @[60rem]/report:grid-cols-2">
        <ReportChartCard title="Review volume">
          {hasSeries ? (
            <ReportBarChart
              title="Reviews received and replied"
              categoryHeading={BIN_HEADING[unit]}
              unitName={unit}
              unitNote={BIN_TOTALS_NOTE[unit]}
              data={bins}
              series={[
                { key: "reviewCount", label: "Reviews", color: 1 },
                { key: "replies", label: "Replies", color: 2 },
              ]}
            />
          ) : (
            <ReportingPanel
              variant="empty"
              title="No reviews in this window"
              description="Figures appear here as reviews arrive from Google."
            />
          )}
        </ReportChartCard>
        <ReportChartCard title="Average rating over time">
          {hasSeries && hasRatings ? (
            <ReportBarChart
              title="Average rating"
              categoryHeading={BIN_HEADING[unit]}
              unitName={unit}
              unitNote={`Average of the ratings received each ${unit}, out of 5.`}
              data={bins}
              max={5}
              format={(value) => value.toFixed(1)}
              series={[
                { key: "averageRating", label: "Average rating", color: 1 },
              ]}
            />
          ) : (
            <ReportingPanel
              variant="empty"
              title="No rated reviews in this window"
              description="A rating appears here once a review with stars arrives."
            />
          )}
        </ReportChartCard>
      </div>

      {/* Only meaningful as a comparison. For a single-location org the table
          would be one row restating the stat tiles directly above it, and at
          zero it would be an empty panel saying what those tiles already say.
          Derived from the data rather than a prop, so it reappears on its own
          the moment a second location is added. */}
      {now.data.locations.length > 1 ? (
        <section
          aria-labelledby="reply-by-location"
          className="flex flex-col gap-2.5"
        >
          <SectionHeader
            as="h3"
            id="reply-by-location"
            title="By location"
            description="Highest response rate first. Missing figures show “—”, never zero."
          />
          <ReplyLocationsTable locations={now.data.locations} />
        </section>
      ) : null}
    </div>
  )
}
