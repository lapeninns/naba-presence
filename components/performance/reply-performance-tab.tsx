"use client"

import { useMemo } from "react"

import { SectionHeader } from "@/components/ui/section-header"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { ReplyFigures } from "@/components/reporting/reply-figures"
import {
  ReportActionsMenu,
  type ReportShareTarget,
} from "@/components/reporting/report-actions-menu"
import { ReportTabHead } from "@/components/reporting/report-tab-head"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { ReportsSkeleton } from "@/components/reporting/reports-skeleton"
import {
  replyLocationsCsv,
  ReplyLocationsTable,
} from "@/components/performance/reply-locations-table"
import { CsvDownloadButton } from "@/components/reporting/csv-download-button"
import { csvFilename } from "@/lib/reporting/csv"
import {
  DEFAULT_RANGES,
  formatPeriod,
  REPLY_RANGES,
  resolveReplyRange,
  type ReplyRangeId,
} from "@/lib/reporting/ranges"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"

function ReplyPerformanceLoading() {
  return <ReportsSkeleton variant="tab" label="Loading reply performance…" />
}

export function ReplyPerformanceTab({
  clientId,
  range,
  share,
}: {
  clientId?: string
  /** What the report's menu shares; none when the viewer may not share. */
  share?: ReportShareTarget | null
  /** The period, kept by the page (in `?range=`); defaults to 28 days. */
  range?: ReplyRangeId
  /** Accepted for the page's API; the picker is in the page's toolbar. */
  onRangeChange?: (range: ReplyRangeId) => void
}) {
  const rangeId = range ?? DEFAULT_RANGES.reply
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
  const rangeLabel =
    REPLY_RANGES.find((option) => option.id === rangeId)?.label ??
    "This window"
  const period = formatPeriod(current, now.data?.timezone ?? "Europe/London")

  // The period is the page's (period strip, toolbar); the tab's head is the
  // "as at" line and the report's actions menu.
  const head = (caption: React.ReactNode) =>
    caption || share ? (
      <ReportTabHead
        caption={caption}
        controls={share ? <ReportActionsMenu share={share} /> : undefined}
      />
    ) : null

  if (now.isPending || now.isError) {
    return (
      <div className="@container/report flex flex-col gap-(--np-gap-section)">
        <h2 className="sr-only">Reply performance</h2>
        {/* No "as at" line: there are no figures to date. */}
        {head(null)}
        {now.isPending ? (
          <ReplyPerformanceLoading />
        ) : (
          <ReportingPanel
            variant="error"
            cause={now.error}
            onRetry={() => void now.refetch()}
          />
        )}
      </div>
    )
  }

  const timezone = now.data.timezone
  const replyFigures = (
    <ReplyFigures
      audience="internal"
      summary={now.data.summary}
      // Nothing in this window: hold the loading state until the comparison
      // window answers, so the page doesn't draw zero tiles and then
      // collapse. A failed comparison draws the tiles without deltas.
      previous={prior.isPending ? "pending" : (prior.data?.summary ?? null)}
      series={now.data.series}
      timezone={timezone}
      unit={unit}
      rangeLabel={rangeLabel}
      periodText={period}
      divergent={now.data.providerTotals.divergence}
      pending={<ReplyPerformanceLoading />}
    />
  )
  const waiting = now.data.summary.reviewVolume === 0 && prior.isPending

  return (
    <div className="@container/report flex flex-col gap-(--np-gap-section)">
      {/* Leading h2 keeps the heading order valid: page h1 -> tab h2 -> card h3 (REV-2). */}
      <h2 className="sr-only">Reply performance</h2>
      {/* No "as at" line while there are no figures to date. */}
      {head(
        waiting ? null : (
          <FetchedAtCaption iso={now.data.to} timezone={timezone} />
        )
      )}

      {replyFigures}

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
            actions={
              <CsvDownloadButton
                filename={csvFilename("reply performance by location", rangeLabel)}
                accessibleLabel="Download reply performance by location as CSV"
                rows={() => replyLocationsCsv(now.data.locations)}
              />
            }
          />
          <ReplyLocationsTable locations={now.data.locations} />
        </section>
      ) : null}
    </div>
  )
}
