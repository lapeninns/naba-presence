"use client"

import { useState } from "react"

import {
  ChartCard,
  ChartLegend,
  ReportingLineChart,
  type ColorVar,
} from "@/components/ui/chart"
import { KpiTile } from "@/components/ui/kpi-tile"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { RangeSelect } from "@/components/performance/range-select"
import { useAnalyticsKeywords } from "@/lib/queries/use-analytics-keywords"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"
import { useAnalyticsPresence } from "@/lib/queries/use-analytics-presence"
import { formatKeywordImpressions } from "@/lib/reporting/keyword-impressions"
import {
  IMPRESSION_METRICS,
  metricLabel,
  ORDERED_METRICS,
} from "@/lib/reporting/metric-labels"
import { PRESENCE_RANGES } from "@/lib/reporting/ranges"
import {
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
} from "@/lib/format"

type PresenceRangeId = (typeof PRESENCE_RANGES)[number]["id"]

const IMPRESSION_SERIES = IMPRESSION_METRICS.map((metric, index) => ({
  key: metric,
  label: metricLabel(metric),
  colorVar: (index + 1) as ColorVar,
}))

const sectionHeadingClassName = "text-title font-semibold text-ink"

export function LocationPerformance({ locationId }: { locationId: string }) {
  const [rangeId, setRangeId] = useState<PresenceRangeId>("28d")
  const overview = useAnalyticsOverview()
  const presence = useAnalyticsPresence({ range: rangeId, locationId })
  const keywords = useAnalyticsKeywords({ range: "6m", locationId })

  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      {/* Review metrics — filtered from the org-wide overview.locations[] */}
      <section className="flex flex-col gap-3">
        {/* "Review activity" (not "Reviews") — the tile below is literally
            labelled "Reviews"; a heading with identical text would either
            resolve findByText("Reviews") before the query settles, or collide
            with the tile once it has (both break the pinned test). */}
        <h2 className={sectionHeadingClassName}>Review activity</h2>
        {overview.isPending ? (
          <ReportingPanel variant="loading" title="Loading review activity…" />
        ) : overview.isError ? (
          <ReportingPanel
            variant="error"
            onRetry={() => void overview.refetch()}
          />
        ) : (
          (() => {
            const row = overview.data.locations.find(
              (location) => location.id === locationId
            )
            if (!row) {
              return (
                <ReportingPanel
                  variant="empty"
                  title="No review activity"
                  description="This location has no reviews in the last 30 days."
                />
              )
            }
            return (
              <div className="grid gap-(--np-gap-card) sm:grid-cols-2 xl:grid-cols-4">
                <KpiTile
                  label="Reviews"
                  value={formatNumber(row.reviews)}
                  hint="Last 30 days"
                />
                <KpiTile
                  label="Average rating"
                  value={
                    row.averageRating === null
                      ? "—"
                      : row.averageRating.toFixed(1)
                  }
                  hint="Out of 5"
                />
                <KpiTile
                  label="Response rate"
                  value={
                    row.responseRate === null
                      ? "—"
                      : formatPercent(row.responseRate)
                  }
                  hint="Published or accepted replies"
                />
                <KpiTile
                  label="Median response time"
                  value={formatDuration(row.medianFirstResponseSeconds)}
                  hint="First reply"
                />
              </div>
            )
          })()
        )}
      </section>

      {/* Google visibility — presence scoped by locationId */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={sectionHeadingClassName}>Visibility on Google</h2>
          <RangeSelect
            value={rangeId}
            onChange={setRangeId}
            options={PRESENCE_RANGES}
            label="Visibility range"
          />
        </div>
        {presence.isPending ? (
          <ReportingPanel
            variant="loading"
            title="Loading visibility figures…"
          />
        ) : presence.isError ? (
          <ReportingPanel
            variant="error"
            onRetry={() => void presence.refetch()}
          />
        ) : !presence.data.ingestionEnabled ? (
          <ReportingPanel
            variant="off"
            title="Not switched on"
            description="Visibility metrics are not switched on for your account yet."
          />
        ) : presence.data.state === "no_link" ? (
          <ReportingPanel
            variant="empty"
            title="Not linked"
            description="This location is not linked to Google."
          />
        ) : presence.data.state !== "ready" ? (
          <ReportingPanel
            variant="empty"
            title="No visibility data yet"
            description="Google has not reported visibility data for this window."
          />
        ) : (
          <>
            <FetchedAtCaption iso={presence.data.freshThrough} timezone="UTC" />
            <div className="grid gap-(--np-gap-card) sm:grid-cols-2 xl:grid-cols-4">
              {ORDERED_METRICS.map((metric) => (
                <KpiTile
                  key={metric}
                  label={metricLabel(metric)}
                  value={formatNumber(presence.data.totals[metric])}
                />
              ))}
            </div>
            <ChartCard
              title="Views over time"
              description={<ChartLegend items={IMPRESSION_SERIES} />}
              state={presence.data.series.length ? "ready" : "empty"}
              emptyLabel="No daily views in this window."
            >
              <ReportingLineChart
                data={presence.data.series.map((point) => ({
                  date: point.date,
                  ...point.metrics,
                }))}
                xKey="date"
                xTickFormatter={(iso) => formatDate(iso, "UTC")}
                series={IMPRESSION_SERIES}
              />
            </ChartCard>
          </>
        )}
      </section>

      {/* Search keywords — keywords scoped by locationId */}
      <section className="flex flex-col gap-3">
        <h2 className={sectionHeadingClassName}>Search keywords</h2>
        {keywords.isPending ? (
          <ReportingPanel variant="loading" title="Loading search keywords…" />
        ) : keywords.isError ? (
          <ReportingPanel
            variant="paused"
            title="Keyword reporting is paused"
            description="Google search-keyword reporting is temporarily paused."
          />
        ) : keywords.data.keywords.length === 0 ? (
          <ReportingPanel
            variant="empty"
            title="No keywords yet"
            description="Google has not reported any search keywords for this location."
          />
        ) : (
          <Table surface>
            <TableHeader>
              <TableRow>
                <TableHead numeric className="w-12">
                  #
                </TableHead>
                <TableHead>Search term</TableHead>
                <TableHead numeric>Impressions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keywords.data.keywords.slice(0, 20).map((keyword) => (
                <TableRow key={`${keyword.rank}-${keyword.keyword}`}>
                  <TableCell numeric className="text-ink-muted">
                    {keyword.rank}
                  </TableCell>
                  <TableCell className="font-medium text-ink" dir="auto">
                    {keyword.keyword}
                  </TableCell>
                  <TableCell numeric>
                    {formatKeywordImpressions(keyword)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  )
}
