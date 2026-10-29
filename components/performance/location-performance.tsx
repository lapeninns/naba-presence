"use client"

import { Link2OffIcon, SearchIcon } from "lucide-react"
import { useMemo } from "react"

import { SectionHeader } from "@/components/ui/section-header"
import { ReportExportScope } from "@/components/reporting/csv-download-button"
import { PresenceProvenance } from "@/components/reporting/presence-provenance"
import {
  ReplyFigures,
  type ReplySummaryFigures,
} from "@/components/reporting/reply-figures"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { UnavailableAlert } from "@/components/reporting/unavailable-alert"
import { KeywordsTable } from "@/components/performance/keywords-table"
import { PresenceFigures } from "@/components/performance/presence-figures"
import { RangeSelect } from "@/components/performance/range-select"
import { ApiClientError } from "@/lib/api/client"
import { useAnalyticsKeywords } from "@/lib/queries/use-analytics-keywords"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"
import { useAnalyticsPresence } from "@/lib/queries/use-analytics-presence"
import type { AnalyticsLocation } from "@/lib/contracts/analytics"
import {
  DEFAULT_RANGES,
  formatPeriod,
  REPLY_RANGES,
  resolveReplyRange,
  type ReplyRangeId,
} from "@/lib/reporting/ranges"
import { LISTING_TERMS } from "@/lib/workspace/terms"

/**
 * One location's row of the overview as reply figures. A location with no
 * reviews in the window has no row: that is zero reviews and every other
 * figure missing, never a made-up zero.
 */
function locationFigures(
  locations: AnalyticsLocation[],
  locationId: string
): ReplySummaryFigures {
  const row = locations.find((location) => location.id === locationId)
  return {
    reviewVolume: row?.reviews ?? 0,
    averageRating: row?.averageRating ?? null,
    responseRate: row?.responseRate ?? null,
    medianFirstResponseSeconds: row?.medianFirstResponseSeconds ?? null,
  }
}

/**
 * One location's report body: review activity, Google visibility and search
 * keywords. The period is the page's (`?range=`, passed as `rangeId`), the
 * same presets and default as Reports: reply figures over the rolling window
 * with the equal window before it for deltas, Google figures over the same
 * preset. The page owns the picker; pass `onRangeChange` to draw one here.
 */
export function LocationPerformance({
  locationId,
  rangeId = DEFAULT_RANGES.reply,
  onRangeChange,
}: {
  locationId: string
  rangeId?: ReplyRangeId
  onRangeChange?: (range: ReplyRangeId) => void
}) {
  // Memoised per range id: resolveReplyRange reads the clock, and fresh
  // from/to strings on every render would mint new query keys and refetch
  // forever.
  const { current, previous } = useMemo(
    () => resolveReplyRange(rangeId),
    [rangeId]
  )
  const overview = useAnalyticsOverview(current)
  const prior = useAnalyticsOverview(previous)
  const presence = useAnalyticsPresence({ range: rangeId, locationId })
  const keywords = useAnalyticsKeywords({ range: "6m", locationId })
  const rangeLabel =
    REPLY_RANGES.find((option) => option.id === rangeId)?.label ?? ""
  const period = formatPeriod(
    current,
    overview.data?.timezone ?? "Europe/London"
  )
  const keywordsPaused =
    keywords.error instanceof ApiClientError &&
    keywords.error.code === "keywords_paused"

  return (
    <div className="@container/report flex flex-col gap-(--np-gap-section)">
      {/* Review metrics: this location's row of the overview, for the
          page's period and the one before it. */}
      <section className="flex flex-col gap-3">
        {/* "Review activity" (not "Reviews") — the tile below is literally
            labelled "Reviews"; a heading with identical text would either
            resolve findByText("Reviews") before the query settles, or collide
            with the tile once it has (both break the pinned test). */}
        <SectionHeader
          title="Review activity"
          description={[rangeLabel, period].filter(Boolean).join(" · ")}
          actions={
            onRangeChange ? (
              <RangeSelect
                value={rangeId}
                onChange={onRangeChange}
                options={REPLY_RANGES}
                period={period}
              />
            ) : undefined
          }
        />
        {overview.isPending ? (
          <ReportingPanel variant="loading" title="Loading review activity…" />
        ) : overview.isError ? (
          <ReportingPanel
            variant="error"
            cause={overview.error}
            onRetry={() => void overview.refetch()}
          />
        ) : (
          <ReplyFigures
            audience="internal"
            summary={locationFigures(overview.data.locations, locationId)}
            previous={
              prior.isPending
                ? "pending"
                : prior.data
                  ? locationFigures(prior.data.locations, locationId)
                  : null
            }
            // The overview's series is the whole scope's, not this
            // location's: no charts rather than someone else's bars.
            series={null}
            timezone={overview.data.timezone}
            unit={current.granularity}
            rangeLabel={rangeLabel}
            periodText={period}
            scope={`this ${LISTING_TERMS.place}`}
          />
        )}
      </section>

      {/* Google visibility — presence scoped by locationId */}
      <section className="flex flex-col gap-3">
        <SectionHeader title="Visibility on Google" description={rangeLabel} />
        {presence.isPending ? (
          <ReportingPanel
            variant="loading"
            title="Loading visibility figures…"
          />
        ) : presence.isError ? (
          <ReportingPanel
            variant="error"
            cause={presence.error}
            onRetry={() => void presence.refetch()}
          />
        ) : !presence.data.ingestionEnabled ? (
          <ReportingPanel
            framed
            titleAs="h3"
            variant="off"
            title="Not switched on"
            description="Visibility metrics are not switched on for your account yet."
          />
        ) : presence.data.state === "no_link" ? (
          <ReportingPanel
            framed
            titleAs="h3"
            variant="empty"
            icon={<Link2OffIcon />}
            title="Not linked"
            description="This listing is not linked to Google."
          />
        ) : presence.data.state === "pending" ? (
          <ReportingPanel framed titleAs="h3" variant="collecting" />
        ) : presence.data.state === "unavailable" ? (
          <UnavailableAlert
            codes={
              presence.data.unavailableReasons.length
                ? presence.data.unavailableReasons
                : ["performance_sync_failed"]
            }
            title="Figures could not be refreshed"
          />
        ) : presence.data.state !== "ready" ? (
          <ReportingPanel
            framed
            titleAs="h3"
            variant="empty"
            title="No visibility data yet"
            description="Google has not reported visibility data for this period."
          />
        ) : (
          <>
            <PresenceProvenance data={presence.data} />
            <UnavailableAlert
              codes={presence.data.unavailableReasons}
              title="Some figures could not be refreshed"
            />
            <ReportExportScope
              value={{ period: `${presence.data.from} ${presence.data.to}` }}
            >
              <PresenceFigures data={presence.data} />
            </ReportExportScope>
          </>
        )}
      </section>

      {/* Search keywords — keywords scoped by locationId */}
      <section className="flex flex-col gap-3">
        <SectionHeader
          title="Search keywords"
          description="Top 20, last 6 months"
        />
        {keywords.isPending ? (
          <ReportingPanel variant="loading" title="Loading search keywords…" />
        ) : keywords.isError ? (
          keywordsPaused ? (
            <ReportingPanel
              framed
              titleAs="h3"
              variant="paused"
              title="Keyword reporting is paused"
              description="Google search-keyword reporting is temporarily paused."
            />
          ) : (
            <ReportingPanel
              variant="error"
              cause={keywords.error}
              onRetry={() => void keywords.refetch()}
            />
          )
        ) : keywords.data.keywords.length === 0 ? (
          <ReportingPanel
            framed
            titleAs="h3"
            variant="empty"
            icon={<SearchIcon />}
            title="No keywords yet"
            description="Google has not reported any search keywords for this listing."
          />
        ) : (
          <KeywordsTable keywords={keywords.data.keywords.slice(0, 20)} />
        )}
      </section>
    </div>
  )
}
