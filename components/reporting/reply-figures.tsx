"use client"

import { BarChart3Icon } from "lucide-react"
import type * as React from "react"

import { KpiTile } from "@/components/ui/kpi-tile"
import { kpiDelta } from "@/components/reporting/delta-badge"
import {
  DivergenceBanner,
  type ReportAudience,
} from "@/components/reporting/divergence-banner"
import {
  ReportBarChart,
  ReportChartCard,
} from "@/components/reporting/report-bar-chart"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import type { AnalyticsGranularity } from "@/lib/contracts/analytics"
import { formatDuration, formatNumber, formatPercent } from "@/lib/format"
import {
  BIN_HEADING,
  BIN_TOTALS_NOTE,
  formatBinLabel,
} from "@/lib/reporting/series-bins"

/**
 * The reply figures: four headline tiles and the two charts over time, with
 * their empty states. One component for the operator's reply tab, the
 * location report and the client's shared report, so the three can no
 * longer drift apart in wording or in what they count.
 *
 * Honesty rules it keeps for every caller:
 * - A missing figure is "—", never 0; a delta is drawn only when both
 *   windows have the figure (`kpiDelta`), and a shorter response time reads
 *   as "faster".
 * - When this window has no reviews it waits for the previous window before
 *   collapsing into one empty panel (`previous === "pending"`), so the page
 *   never draws zero tiles and then folds them away. When the previous
 *   window had reviews, the tiles stay: the drop to zero is the finding.
 * - The charts never contradict the tiles: when the tiles count reviews but
 *   the series has none to draw, the card says the chart is unavailable
 *   rather than "No reviews in this window".
 */

export type ReplySummaryFigures = {
  reviewVolume: number
  averageRating: number | null
  responseRate: number | null
  medianFirstResponseSeconds: number | null
}

export type ReplySeriesPoint = {
  period: string
  reviewCount: number
  replies: number
  averageRating: number | null
}

/**
 * The reply metrics' labels and hints, one dictionary for every audience.
 * Response rate counts replies Google has accepted or published
 * (lib/server/analytics-overview.ts), which is what "posted to Google" says
 * to an operator and a client alike.
 */
export const REPLY_METRICS = {
  reviews: { label: "Reviews", hint: undefined },
  responseRate: {
    label: "Response rate",
    hint: "Reviews with a reply posted to Google",
  },
  medianResponse: {
    label: "Median response time",
    hint: "Review received to first reply",
  },
  averageRating: { label: "Average rating", hint: "Out of 5" },
} as const

const COPY: Record<
  ReportAudience,
  {
    span: string
    empty: (range: string, period: string, scope: string) => string
    chartEmpty: string
    chartEmptyBody?: string
    ratingEmpty: string
    ratingEmptyBody?: string
  }
> = {
  internal: {
    span: "window",
    empty: (range, period, scope) =>
      `Nothing has been collected for ${scope} in the ${range}${period ? ` (${period})` : ""}. Figures appear here as reviews arrive from Google.`,
    chartEmpty: "No reviews in this window",
    chartEmptyBody: "Figures appear here as reviews arrive from Google.",
    ratingEmpty: "No rated reviews in this window",
    ratingEmptyBody: "A rating appears here once a review with stars arrives.",
  },
  public: {
    span: "period",
    empty: (range, _period, scope) =>
      `No reviews arrived for ${scope} in the ${range}.`,
    chartEmpty: "No reviews in this period",
    ratingEmpty: "No rated reviews in this period",
  },
}

/** Tiles two to a row on any phone, four from 48rem of report width. */
export const REPLY_TILE_GRID =
  "grid grid-cols-2 gap-3 @[48rem]/report:grid-cols-4"

/**
 * Whether the series can be drawn for a summary. False when the tiles count
 * reviews but no bucket does: the chart would say "no reviews" beside a
 * tile that says otherwise, so it is unavailable instead.
 */
export function seriesAgrees(
  summary: Pick<ReplySummaryFigures, "reviewVolume">,
  series: ReadonlyArray<Pick<ReplySeriesPoint, "reviewCount">>
): boolean {
  const drawn = series.reduce((sum, point) => sum + point.reviewCount, 0)
  return !(summary.reviewVolume > 0 && drawn === 0)
}

function ChartUnavailable({ span }: { span: string }) {
  return (
    <ReportingPanel
      variant="empty"
      icon={<BarChart3Icon />}
      title={`Chart unavailable for this ${span}`}
      description="The totals above are complete; the breakdown over time could not be drawn."
    />
  )
}

export function ReplyFigures({
  audience,
  summary,
  previous,
  series,
  timezone,
  unit,
  rangeLabel,
  periodText = "",
  scope,
  csvPrefix = "",
  divergent = false,
  pending,
}: {
  audience: ReportAudience
  summary: ReplySummaryFigures
  /**
   * The equal-length window before this one: its figures, `null` when it
   * could not be read (no deltas), or "pending" while it is still loading.
   */
  previous: ReplySummaryFigures | null | "pending"
  /** The reply series; omit for a scope that has none (one location). */
  series?: ReadonlyArray<ReplySeriesPoint> | null
  /** The organisation's zone, for the chart labels. */
  timezone: string
  unit: AnalyticsGranularity
  /** "Last 28 days". */
  rangeLabel: string
  /** "15 Sept – 13 Oct", when known. */
  periodText?: string
  /** Who the figures cover: "these locations", "this location". */
  scope?: string
  /** Leads the CSV file names: the client's name on the shared report. */
  csvPrefix?: string
  /** Google's totals disagree with what has been collected. */
  divergent?: boolean
  /** Drawn while the comparison is pending for an empty window. */
  pending?: React.ReactNode
}) {
  const copy = COPY[audience]
  const span = copy.span
  const prior = previous === "pending" ? null : previous
  const banner = <DivergenceBanner divergent={divergent} audience={audience} />

  if (summary.reviewVolume === 0 && previous === "pending") {
    return (
      pending ?? (
        <ReportingPanel variant="loading" title="Loading reply figures…" />
      )
    )
  }

  if (summary.reviewVolume === 0 && (prior?.reviewVolume ?? 0) === 0) {
    return (
      <div className="flex flex-col gap-(--np-gap-section)">
        {banner}
        <ReportingPanel
          framed
          variant="empty"
          title={
            audience === "public"
              ? "No reviews in this period"
              : "No reviews in this window yet"
          }
          description={copy.empty(
            rangeLabel.toLowerCase(),
            periodText,
            scope ??
              (audience === "public" ? "these venues" : "these locations")
          )}
        />
      </div>
    )
  }

  const points = series ?? null
  const agrees = points ? seriesAgrees(summary, points) : true
  const hasSeries = !!points?.some((point) => point.reviewCount > 0)
  const hasRatings = !!points?.some((point) => point.averageRating !== null)
  const bins = (points ?? []).map((point) => ({
    label: formatBinLabel(point.period, unit, timezone),
    values: {
      reviewCount: point.reviewCount,
      replies: point.replies,
      averageRating: point.averageRating,
    },
  }))
  const prefix = csvPrefix ? `${csvPrefix} ` : ""
  const comparedWith = rangeLabel.toLowerCase().replace(/^last /, "")

  return (
    <div className="@container/report flex flex-col gap-(--np-gap-section)">
      {banner}
      <div className="flex flex-col gap-2">
        <div className={REPLY_TILE_GRID} data-slot="reply-tiles">
          <KpiTile
            label={REPLY_METRICS.reviews.label}
            value={formatNumber(summary.reviewVolume)}
            delta={kpiDelta(
              summary.reviewVolume,
              prior?.reviewVolume ?? null,
              "count"
            )}
          />
          <KpiTile
            label={REPLY_METRICS.responseRate.label}
            value={
              summary.responseRate === null
                ? "—"
                : formatPercent(summary.responseRate)
            }
            delta={kpiDelta(
              summary.responseRate,
              prior?.responseRate ?? null,
              "percent"
            )}
            hint={REPLY_METRICS.responseRate.hint}
          />
          {/* Duration-typed delta: "▼ −20m" (faster), never raw seconds. */}
          <KpiTile
            label={REPLY_METRICS.medianResponse.label}
            value={formatDuration(summary.medianFirstResponseSeconds)}
            delta={kpiDelta(
              summary.medianFirstResponseSeconds,
              prior?.medianFirstResponseSeconds ?? null,
              "duration"
            )}
            hint={REPLY_METRICS.medianResponse.hint}
          />
          <KpiTile
            label={REPLY_METRICS.averageRating.label}
            value={
              summary.averageRating === null
                ? "—"
                : summary.averageRating.toFixed(1)
            }
            delta={kpiDelta(
              summary.averageRating,
              prior?.averageRating ?? null,
              "rating"
            )}
            hint={REPLY_METRICS.averageRating.hint}
          />
        </div>
        {prior ? (
          <p className="text-caption text-ink-muted">
            Changes compare with the {comparedWith} before this {span}.
          </p>
        ) : null}
      </div>

      {points ? (
        <div className="grid grid-cols-1 gap-(--np-gap-card) @[60rem]/report:grid-cols-2">
          <ReportChartCard title="Review volume">
            {hasSeries ? (
              <ReportBarChart
                title="Reviews received and replied"
                csvName={`${prefix}review volume ${rangeLabel}`}
                categoryHeading={BIN_HEADING[unit]}
                unitName={unit}
                unitNote={BIN_TOTALS_NOTE[unit]}
                data={bins}
                series={[
                  { key: "reviewCount", label: "Reviews", color: 1 },
                  { key: "replies", label: "Replies", color: 2 },
                ]}
              />
            ) : !agrees ? (
              <ChartUnavailable span={span} />
            ) : (
              <ReportingPanel
                variant="empty"
                title={copy.chartEmpty}
                description={copy.chartEmptyBody}
              />
            )}
          </ReportChartCard>
          <ReportChartCard title="Average rating over time">
            {hasSeries && hasRatings ? (
              <ReportBarChart
                title="Average rating"
                csvName={`${prefix}average rating ${rangeLabel}`}
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
            ) : !agrees || summary.averageRating !== null ? (
              <ChartUnavailable span={span} />
            ) : (
              <ReportingPanel
                variant="empty"
                title={copy.ratingEmpty}
                description={copy.ratingEmptyBody}
              />
            )}
          </ReportChartCard>
        </div>
      ) : null}
    </div>
  )
}
