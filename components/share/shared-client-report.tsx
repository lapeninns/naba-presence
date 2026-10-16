"use client"

import { EYEBROW_CLASS } from "@/components/app-shell/page-frame"
import { PresenceFigures } from "@/components/performance/presence-figures"
import { PartialCoverageAlert } from "@/components/reporting/partial-coverage-alert"
import {
  PresenceProvenance,
  ZonedTime,
} from "@/components/reporting/presence-provenance"
import { ReplyLocationsTable } from "@/components/performance/reply-locations-table"
import { ReplyFigures } from "@/components/reporting/reply-figures"
import { textTabItemClassName } from "@/components/ui/tabs"
import type { AnalyticsLocation } from "@/lib/contracts/analytics"
import type { PresenceResponse } from "@/lib/contracts/analytics"
import {
  SHARE_PERIODS,
  type SharedClientReport,
} from "@/lib/contracts/report-shares"
import { formatPeriod } from "@/lib/reporting/ranges"
import { cn } from "@/lib/utils"

/**
 * The public client report (`/share/report/[token]`): one client's reply and
 * Google figures, read-only, for someone with no account.
 *
 * Everything drawn comes from `report`, the SharedClientReport DTO built on
 * the server (lib/server/shared-report.ts), which carries aggregates and the
 * client's, venues' and agency's names only. The page has no app chrome and
 * no links into the app; the only links are the three periods, which reload
 * this same page (plain links, so they work before or without JavaScript,
 * and each ends `#main` so the reload lands on the figures rather than the
 * top), and the skip link to the figures. Printing (the browser's own Print, or
 * Save as PDF) drops the period switcher and the charts' buttons, keeps the
 * figures, and starts the Google section on a new page.
 *
 * It is most often read on the client's phone: tiles two to a row from
 * 320px, charts that scroll inside their own box with a table behind them,
 * and every time written in the organisation's zone with the zone named, so
 * the server's HTML and the browser's agree.
 */
export function SharedClientReportView({
  report,
}: {
  report: SharedClientReport
}) {
  const { replies, google, period, timezone } = report
  const periodText = formatPeriod(period, timezone)
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
        previous: google.previous ?? null,
        fetchedAt: google.fetchedAt,
        coverage: google.coverage,
        dateBasis: "google_daily",
        // Positional keys, as for the venue table: the DTO carries names only.
        completeness: google.completeness
          ? {
              ...google.completeness,
              missing: google.completeness.missing.map((location, index) => ({
                ...location,
                id: `missing-${index + 1}`,
              })),
              refreshFailed: google.completeness.refreshFailed.map(
                (location, index) => ({
                  ...location,
                  id: `behind-${index + 1}`,
                })
              ),
            }
          : null,
      }
    : null

  return (
    <div
      className={cn(
        "@container/report mx-auto flex w-full max-w-5xl flex-col gap-(--np-gap-section) px-5 py-8 sm:px-6 sm:py-10",
        // Print: the figures only, edge to edge on the page; no buttons.
        "print:max-w-none print:gap-6 print:p-0 print:[&_button]:hidden print:[&_figure]:break-inside-avoid print:[&_section]:break-inside-avoid"
      )}
    >
      <a
        href="#main"
        className="sr-only z-skip-link rounded-full bg-primary px-4 py-2 text-ui font-semibold text-primary-foreground focus-halo focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus-visible:outline-none print:hidden"
      >
        Skip to the figures
      </a>
      <header className="flex flex-col gap-3 border-b border-line-subtle pb-5">
        <p className={EYEBROW_CLASS}>Performance report</p>
        <h1 className="text-page-title font-semibold text-balance [overflow-wrap:anywhere] text-ink">
          {report.clientName}
        </h1>
        <p className="text-ui text-ink">
          {period.label}
          {periodText ? (
            <span className="text-ink-muted"> · {periodText}</span>
          ) : null}
        </p>
        {/* Notion Mail text tabs, drawn with the TextTabs item style but as
            plain anchors in a wrapping row: TabNav's Next links would
            navigate client-side (and may prefetch this view-counted page),
            and its strip scrolls sideways, which a public page should not. */}
        <nav aria-label="Report period" className="pt-1 print:hidden">
          <ul className="-ms-2 flex list-none flex-wrap gap-0.5">
            {SHARE_PERIODS.map((option) => (
              <li key={option.id} className="flex">
                <a
                  href={`?period=${option.id}#main`}
                  aria-current={option.id === period.id ? "page" : undefined}
                  className={textTabItemClassName}
                >
                  {option.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className="flex flex-col gap-(--np-gap-section) outline-none print:gap-6"
      >
        <section
          aria-labelledby="shared-replies"
          className="flex flex-col gap-(--np-gap-section)"
        >
          <h2
            id="shared-replies"
            className="text-section font-semibold text-ink"
          >
            Reviews and replies
          </h2>

          <ReplyFigures
            audience="public"
            summary={replies.summary}
            previous={replies.previous}
            series={replies.series}
            timezone={timezone}
            unit={period.granularity}
            rangeLabel={period.label}
            periodText={periodText}
            csvPrefix={report.clientName}
            divergent={replies.incomplete}
          />

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
                two-star reviews without a published reply. Missing figures show
                “—”, never zero.
              </p>
              <ReplyLocationsTable locations={locations} linked={false} />
            </section>
          ) : null}
        </section>

        {presence ? (
          <section
            aria-labelledby="shared-google"
            className="flex flex-col gap-(--np-gap-section) print:break-before-page"
          >
            <div className="flex flex-col gap-1">
              <h2
                id="shared-google"
                className="text-section font-semibold text-ink"
              >
                Google Business Profile
              </h2>
              <p className="text-caption text-ink-muted">
                {formatPeriod(presence, "UTC")}
              </p>
              <PresenceProvenance data={presence} timeZone={timezone} />
            </div>
            <PartialCoverageAlert
              completeness={presence.completeness}
              nouns={{ one: "venue", many: "venues" }}
            />
            <PresenceFigures data={presence} />
          </section>
        ) : null}
      </main>

      <footer className="flex flex-col gap-3 border-t border-line-subtle pt-4 text-caption text-ink-muted">
        <dl className="grid gap-x-8 gap-y-0.5 sm:grid-cols-[auto_1fr] sm:gap-y-1">
          <dt className="mt-2 first:mt-0 sm:mt-0">
            {report.venues.length === 1 ? "Venue" : "Venues"}
          </dt>
          <dd className="[overflow-wrap:anywhere] text-ink">
            {report.venues.length ? report.venues.join(", ") : "None yet"}
          </dd>
          <dt className="mt-2 first:mt-0 sm:mt-0">Prepared by</dt>
          <dd className="[overflow-wrap:anywhere] text-ink">
            {report.agencyName}
          </dd>
          <dt className="mt-2 first:mt-0 sm:mt-0">Generated</dt>
          <dd className="text-ink tabular-nums">
            <ZonedTime iso={report.generatedAt} timeZone={timezone} />
          </dd>
        </dl>
        <p>
          A read-only report prepared by {report.agencyName} for{" "}
          {report.clientName}. It shows totals only: no individual reviews,
          reviewers or replies. Review figures come from Google reviews
          collected for these venues; profile figures are as reported by Google.
        </p>
      </footer>
    </div>
  )
}
