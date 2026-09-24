"use client"

import { EYEBROW_CLASS } from "@/components/app-shell/page-frame"
import { PresenceFigures } from "@/components/performance/presence-figures"
import { ReplyLocationsTable } from "@/components/performance/reply-locations-table"
import { kpiDelta } from "@/components/reporting/delta-badge"
import {
  ReportBarChart,
  ReportChartCard,
} from "@/components/reporting/report-bar-chart"
import { reportTileGridClassName } from "@/components/reporting/report-tab-head"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { KpiTile } from "@/components/ui/kpi-tile"
import type { AnalyticsLocation } from "@/lib/contracts/analytics"
import type { PresenceResponse } from "@/lib/contracts/analytics"
import {
  SHARE_PERIODS,
  type SharedClientReport,
} from "@/lib/contracts/report-shares"
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
} from "@/lib/format"
import { formatPeriod } from "@/lib/reporting/ranges"
import {
  BIN_HEADING,
  BIN_TOTALS_NOTE,
  formatBinLabel,
} from "@/lib/reporting/series-bins"
import { cn } from "@/lib/utils"

/**
 * The public client report (`/share/report/[token]`): one client's reply and
 * Google figures, read-only, for someone with no account.
 *
 * Everything drawn comes from `report`, the SharedClientReport DTO built on
 * the server (lib/server/shared-report.ts), which carries aggregates and the
 * client's, venues' and agency's names only. The page has no app chrome and
 * no links into the app; the only links are the three periods, which reload
 * this same page. Printing (the browser's own Print, or Save as PDF) drops
 * the period switcher and the charts' buttons and keeps the figures.
 */
export function SharedClientReportView({
  report,
}: {
  report: SharedClientReport
}) {
  const { replies, google, period, timezone } = report
  const s = replies.summary
  const p = replies.previous
  const unit = period.granularity
  const periodText = formatPeriod(period, timezone)

  const bins = replies.series.map((point) => ({
    label: formatBinLabel(point.period, unit, timezone),
    values: {
      reviewCount: point.reviewCount,
      replies: point.replies,
      averageRating: point.averageRating,
    },
  }))
  const hasSeries = replies.series.some((point) => point.reviewCount > 0)
  const hasRatings = replies.series.some(
    (point) => point.averageRating !== null
  )
  // The shared table component, fed only what the DTO carries: positional
  // keys instead of location ids, and nothing it does not show.
  const locations: AnalyticsLocation[] = replies.locations.map(
    (location, index) => ({
      id: `venue-${index + 1}`,
      name: location.name,
      reviews: location.reviews,
      averageRating: location.averageRating,
      responseRate: location.responseRate,
      medianFirstResponseSeconds: location.medianFirstResponseSeconds,
      p95FirstResponseSeconds: null,
      medianLatestEditSeconds: null,
      unresolvedComplaints: location.unresolvedComplaints,
      verificationRejectionRate: null,
    })
  )
  const presence: PresenceResponse | null = google
    ? {
        range: period.id,
        from: google.from,
        to: google.to,
        state: "ready",
        freshThrough: google.freshThrough,
        locations: [],
        totals: google.totals,
        series: google.series.map((point) => ({
          date: point.date,
          metrics: point.metrics as Record<string, number>,
        })),
        unavailableReasons: [],
        keywordsEnabled: false,
        ingestionEnabled: true,
      }
    : null

  return (
    <main
      id="main"
      tabIndex={-1}
      className={cn(
        "@container/report mx-auto flex w-full max-w-[1080px] flex-col gap-(--np-gap-section) px-4 py-8 outline-none sm:px-6 sm:py-10",
        // Print: the figures only, edge to edge on the page; no buttons.
        "print:max-w-none print:gap-6 print:p-0 print:[&_button]:hidden print:[&_figure]:break-inside-avoid print:[&_section]:break-inside-avoid"
      )}
    >
      <header className="flex flex-col gap-3 border-b border-line pb-6">
        <p className={EYEBROW_CLASS}>Performance report</p>
        <h1 className="font-display text-page-title font-semibold text-balance [overflow-wrap:anywhere] text-ink">
          {report.clientName}
        </h1>
        <dl className="grid gap-x-8 gap-y-2 text-ui text-ink sm:grid-cols-[auto_1fr]">
          <dt className="text-ink-muted">Period</dt>
          <dd>
            {period.label}
            {periodText ? (
              <span className="text-ink-muted"> · {periodText}</span>
            ) : null}
          </dd>
          <dt className="text-ink-muted">
            {report.venues.length === 1 ? "Venue" : "Venues"}
          </dt>
          <dd className="[overflow-wrap:anywhere]">
            {report.venues.length ? report.venues.join(", ") : "None yet"}
          </dd>
          <dt className="text-ink-muted">Prepared by</dt>
          <dd className="[overflow-wrap:anywhere]">{report.agencyName}</dd>
          <dt className="text-ink-muted">Generated</dt>
          <dd className="font-mono tabular-nums">
            {formatDateTime(report.generatedAt, timezone)}
          </dd>
        </dl>
        <nav aria-label="Report period" className="print:hidden">
          <ul className="flex flex-wrap gap-2">
            {SHARE_PERIODS.map((option) => {
              const current = option.id === period.id
              return (
                <li key={option.id}>
                  <a
                    href={`?period=${option.id}`}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "inline-flex min-h-(--np-touch) items-center rounded-(--np-radius-control) border px-3 text-ui focus-halo focus-visible:outline-none",
                      current
                        ? "border-ink bg-ink text-canvas"
                        : "border-line bg-surface text-ink hover:border-line-strong"
                    )}
                  >
                    {option.label}
                  </a>
                </li>
              )
            })}
          </ul>
        </nav>
      </header>

      <section
        aria-labelledby="shared-replies"
        className="flex flex-col gap-(--np-gap-section)"
      >
        <h2 id="shared-replies" className="text-title font-semibold text-ink">
          Reviews and replies
        </h2>

        {replies.incomplete ? (
          <Alert variant="warning">
            <AlertTitle>These figures may be incomplete</AlertTitle>
            <AlertDescription>
              Google reports a different review total or rating than has been
              collected so far, so some recent reviews may not be counted yet.
            </AlertDescription>
          </Alert>
        ) : null}

        {s.reviewVolume === 0 && (p?.reviewVolume ?? 0) === 0 ? (
          <ReportingPanel
            framed
            variant="empty"
            title="No reviews in this period"
            description={`No reviews arrived for these venues in the ${period.label.toLowerCase()}.`}
          />
        ) : (
          <>
            <div className={reportTileGridClassName()}>
              <KpiTile
                label="Reviews"
                value={formatNumber(s.reviewVolume)}
                delta={kpiDelta(
                  s.reviewVolume,
                  p?.reviewVolume ?? null,
                  "count"
                )}
              />
              <KpiTile
                label="Response rate"
                value={
                  s.responseRate === null ? "—" : formatPercent(s.responseRate)
                }
                delta={kpiDelta(
                  s.responseRate,
                  p?.responseRate ?? null,
                  "percent"
                )}
                hint="Reviews with a published reply"
              />
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
                value={
                  s.averageRating === null ? "—" : s.averageRating.toFixed(1)
                }
                delta={kpiDelta(
                  s.averageRating,
                  p?.averageRating ?? null,
                  "rating"
                )}
                hint="Out of 5"
              />
            </div>
            <p className="text-caption text-ink-muted">
              Changes compare with the{" "}
              {period.label.toLowerCase().replace("last ", "")} before this
              period.
            </p>

            <div className="grid grid-cols-1 gap-(--np-gap-card) @[60rem]/report:grid-cols-2">
              <ReportChartCard title="Review volume">
                {hasSeries ? (
                  <ReportBarChart
                    title="Reviews received and replied"
                    csvName={`${report.clientName} review volume ${period.label}`}
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
                    title="No reviews in this period"
                  />
                )}
              </ReportChartCard>
              <ReportChartCard title="Average rating over time">
                {hasSeries && hasRatings ? (
                  <ReportBarChart
                    title="Average rating"
                    csvName={`${report.clientName} average rating ${period.label}`}
                    categoryHeading={BIN_HEADING[unit]}
                    unitName={unit}
                    unitNote={`Average of the ratings received each ${unit}, out of 5.`}
                    data={bins}
                    max={5}
                    format={(value) => value.toFixed(1)}
                    series={[
                      {
                        key: "averageRating",
                        label: "Average rating",
                        color: 1,
                      },
                    ]}
                  />
                ) : (
                  <ReportingPanel
                    variant="empty"
                    title="No rated reviews in this period"
                  />
                )}
              </ReportChartCard>
            </div>

            {locations.length > 1 ? (
              <section
                aria-labelledby="shared-by-venue"
                className="flex flex-col gap-2.5"
              >
                <h3
                  id="shared-by-venue"
                  className="text-title font-semibold text-ink"
                >
                  By venue
                </h3>
                <p className="text-caption text-ink-muted">
                  Highest response rate first. “Unresolved” counts one- and
                  two-star reviews without a published reply. Missing figures
                  show “—”, never zero.
                </p>
                <ReplyLocationsTable locations={locations} linked={false} />
              </section>
            ) : null}
          </>
        )}
      </section>

      {presence ? (
        <section
          aria-labelledby="shared-google"
          className="flex flex-col gap-(--np-gap-section) print:break-before-page"
        >
          <div className="flex flex-col gap-1">
            <h2
              id="shared-google"
              className="text-title font-semibold text-ink"
            >
              Google Business Profile
            </h2>
            <p className="text-caption text-ink-muted">
              {formatPeriod(presence, "UTC")}
              {presence.freshThrough
                ? ` · Google figures as at ${formatDate(presence.freshThrough, "UTC")}`
                : ""}
            </p>
          </div>
          <PresenceFigures data={presence} />
        </section>
      ) : null}

      <footer className="border-t border-line pt-4 text-caption text-ink-muted">
        A read-only report prepared by {report.agencyName} for{" "}
        {report.clientName}. It shows totals only: no individual reviews,
        reviewers or replies. Review figures come from Google reviews collected
        for these venues; profile figures are as reported by Google.
      </footer>
    </main>
  )
}
