"use client"

import * as React from "react"

import { useReviewLinkStats } from "@/components/listings/review-link-queries"
import { ReportBarChart } from "@/components/reporting/report-bar-chart"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { KpiStrip, KpiTile } from "@/components/ui/kpi-tile"
import { QueryPending } from "@/components/ui/query-states"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import {
  REVIEW_LINK_PERIODS,
  type ReviewLinkPeriod,
} from "@/lib/domain/review-link"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatDayMonth } from "@/lib/format/date"
import { formatNumber } from "@/lib/format/number"

/**
 * Link opens beside new reviews, per day at the venue, over the last 30 or
 * 90 days: the period first, then the totals, then the chart, as the
 * performance figures lay them out. Opens are scans and taps, not people.
 * New reviews arrive with the next sync from Google, so the latest days can
 * read low for a while.
 */
export function ReviewLinkStats({ locationId }: { locationId: string }) {
  const [days, setDays] = React.useState<ReviewLinkPeriod>(30)
  const stats = useReviewLinkStats(locationId, days)
  const headingId = React.useId()

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3"
      data-slot="review-link-stats"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id={headingId} className="text-section font-semibold text-ink">
          Opens and new reviews
        </h2>
        <SegmentedControl
          value={String(days)}
          onValueChange={(value) => setDays(Number(value) === 90 ? 90 : 30)}
          aria-label="Period"
        >
          {REVIEW_LINK_PERIODS.map((option) => (
            <SegmentedControlItem key={option} value={String(option)}>
              {option} days
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>
      {stats.isPending ? (
        <QueryPending label="Counting opens and reviews…" />
      ) : stats.isError ? (
        <ReportingPanel
          variant="error"
          description={`${describeActionError(stats.error)} Nothing was changed.`}
          onRetry={() => void stats.refetch()}
        />
      ) : (
        <>
          <KpiStrip>
            <KpiTile
              label="Link opens"
              value={formatNumber(stats.data.totals.clicks)}
              hint={`Last ${stats.data.days} days`}
              size="compact"
            />
            <KpiTile
              label="From the QR code"
              value={formatNumber(stats.data.totals.qrClicks)}
              hint="Included in link opens"
              size="compact"
            />
            <KpiTile
              label="New reviews"
              value={formatNumber(stats.data.totals.newReviews)}
              hint="From any source"
              size="compact"
            />
          </KpiStrip>
          <Card data-slot="review-link-chart">
            <CardHeader>
              <CardTitle as="h3">Per day</CardTitle>
              <CardDescription>
                Opens count every scan or tap, not people. New reviews arrive
                with the next sync from Google, so the latest days may read low
                for a while.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-3">
              {stats.data.totals.clicks === 0 &&
              stats.data.totals.newReviews === 0 ? (
                <ReportingPanel
                  variant="empty"
                  description="No opens or new reviews in this period."
                />
              ) : (
                <ReportBarChart
                  title="Review link opens and new reviews"
                  categoryHeading="Day"
                  unitName="day"
                  unitNote="Daily totals, on the venue’s calendar."
                  csvName={`review-link-${stats.data.days}-days`}
                  data={stats.data.series.map((day) => ({
                    label: formatDayMonth(
                      new Date(`${day.date}T12:00:00Z`),
                      "UTC"
                    ),
                    values: { opens: day.clicks, reviews: day.newReviews },
                  }))}
                  series={[
                    { key: "opens", label: "Link opens", color: 1 },
                    { key: "reviews", label: "New reviews", color: 2 },
                  ]}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  )
}
