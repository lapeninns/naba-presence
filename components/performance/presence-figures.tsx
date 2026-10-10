"use client"

import { useId } from "react"

import { CsvDownloadButton } from "@/components/reporting/csv-download-button"
import { kpiDelta } from "@/components/reporting/delta-badge"
import { KpiTile } from "@/components/ui/kpi-tile"
import {
  ReportBarChart,
  ReportChartCard,
} from "@/components/reporting/report-bar-chart"
import { reportTileGridClassName } from "@/components/reporting/report-tab-head"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import type { PresenceResponse } from "@/lib/contracts/analytics"
import { formatNumber } from "@/lib/format"
import { csvFilename, type CsvCell } from "@/lib/reporting/csv"
import {
  ACTION_SERIES_KEYS,
  HEADLINE_METRICS,
  metricLabel,
  ORDERED_METRICS,
  OTHER_ACTION_METRICS,
  sumMetrics,
  VIEW_SERIES_KEYS,
} from "@/lib/reporting/metric-labels"
import {
  BIN_HEADING,
  BIN_TOTALS_NOTE,
  binDailySeries,
  binUnitFor,
  daysInWindow,
  formatBinLabel,
} from "@/lib/reporting/series-bins"

/**
 * A ready presence report: the five headline tiles, the other profile
 * actions, then views (Search and Maps stacked) and actions (calls, website
 * clicks, directions stacked) over time. Long ranges are drawn a bar per
 * week or month; each bar is the sum of the days inside it.
 */
/**
 * Every Google metric total for the window, with the previous window beside
 * it. A metric Google sent nothing for is an empty cell, never 0.
 */
export function presenceTotalsCsv(data: PresenceResponse): CsvCell[][] {
  const previous = data.previous
  return [
    [
      "Metric",
      "Google metric",
      `${data.from} to ${data.to}`,
      previous ? `${previous.from} to ${previous.to}` : "Previous window",
      "Data through",
    ],
    ...ORDERED_METRICS.map((metric) => [
      metricLabel(metric),
      metric,
      data.totals[metric],
      previous?.totals[metric] ?? null,
      data.freshThrough,
    ]),
  ]
}

/** Google sent nothing for this figure in the window: say so rather than print 0. */
function formatFigure(value: number | null) {
  return value === null ? "No data" : formatNumber(value)
}

export function PresenceFigures({ data }: { data: PresenceResponse }) {
  // Bin by the report window, not by how many days Google reported: a year
  // with ten reported days is still drawn a bar per month.
  const reportWindow = { from: data.from, to: data.to }
  const windowDays = daysInWindow(data.from, data.to).length
  const unit = binUnitFor(windowDays || data.series.length)
  const toBars = (keys: Record<string, readonly string[]>) =>
    binDailySeries(
      data.series,
      keys,
      unit,
      windowDays ? reportWindow : undefined
    ).map((bin) => ({
      label: formatBinLabel(bin.start, unit, "UTC"),
      values: bin.values,
    }))
  const views = toBars(VIEW_SERIES_KEYS)
  const actions = toBars(ACTION_SERIES_KEYS)
  const otherId = useId()

  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      <div className="-mb-3 flex justify-end print:hidden">
        <CsvDownloadButton
          filename={csvFilename("google profile totals", data.from, data.to)}
          rows={() => presenceTotalsCsv(data)}
          label="Download totals CSV"
          accessibleLabel="Download Google profile totals as CSV"
        />
      </div>
      <div className={reportTileGridClassName(5)}>
        {HEADLINE_METRICS.map((metric) => (
          <KpiTile
            key={metric.key}
            label={metric.label}
            value={formatFigure(sumMetrics(data.totals, metric.metrics))}
            hint={metric.hint}
            delta={
              data.previous
                ? kpiDelta(
                    sumMetrics(data.totals, metric.metrics),
                    sumMetrics(data.previous.totals, metric.metrics),
                    "count"
                  )
                : undefined
            }
          />
        ))}
      </div>

      <section
        aria-labelledby={otherId}
        className="flex flex-col gap-3 rounded-(--np-radius-card) border border-line bg-surface px-4 py-3.5"
      >
        <h3 id={otherId} className="text-ui font-semibold text-ink">
          Other actions on the profile
        </h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 @[40rem]/report:grid-cols-4">
          {OTHER_ACTION_METRICS.map((metric) => (
            <div key={metric} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-caption text-ink-muted">
                {metricLabel(metric)}
              </dt>
              <dd className="font-mono text-body font-semibold text-ink tabular-nums">
                {formatFigure(data.totals[metric])}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-(--np-gap-card) @[60rem]/report:grid-cols-2">
        <ReportChartCard title="Views: Search and Maps">
          {data.series.length ? (
            <ReportBarChart
              title="Search and Maps views"
              categoryHeading={BIN_HEADING[unit]}
              unitName={unit}
              unitNote={BIN_TOTALS_NOTE[unit]}
              stacked
              data={views}
              series={[
                { key: "search", label: "Search views", color: 1 },
                { key: "maps", label: "Maps views", color: 2 },
              ]}
            />
          ) : (
            <ReportingPanel
              variant="empty"
              description="No daily views in this window."
            />
          )}
        </ReportChartCard>
        <ReportChartCard title="Actions over time">
          {data.series.length ? (
            <ReportBarChart
              title="Call button taps, website clicks and directions requests"
              categoryHeading={BIN_HEADING[unit]}
              unitName={unit}
              unitNote={BIN_TOTALS_NOTE[unit]}
              stacked
              data={actions}
              series={[
                { key: "calls", label: metricLabel("CALL_CLICKS"), color: 1 },
                { key: "web", label: "Website clicks", color: 2 },
                {
                  key: "directions",
                  label: metricLabel("BUSINESS_DIRECTION_REQUESTS"),
                  color: 3,
                },
              ]}
            />
          ) : (
            <ReportingPanel
              variant="empty"
              description="No daily actions in this window."
            />
          )}
        </ReportChartCard>
      </div>
    </div>
  )
}
