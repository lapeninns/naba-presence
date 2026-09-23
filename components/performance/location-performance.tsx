"use client"

import { Link2OffIcon, SearchIcon } from "lucide-react"
import { useState } from "react"

import { KpiTile } from "@/components/ui/kpi-tile"
import { SectionHeader } from "@/components/ui/section-header"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { reportTileGridClassName } from "@/components/reporting/report-tab-head"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { UnavailableAlert } from "@/components/reporting/unavailable-alert"
import { KeywordsTable } from "@/components/performance/keywords-table"
import { PresenceFigures } from "@/components/performance/presence-figures"
import { RangeSelect } from "@/components/performance/range-select"
import { ApiClientError } from "@/lib/api/client"
import { useAnalyticsKeywords } from "@/lib/queries/use-analytics-keywords"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"
import { useAnalyticsPresence } from "@/lib/queries/use-analytics-presence"
import { PRESENCE_RANGES } from "@/lib/reporting/ranges"
import { formatDuration, formatNumber, formatPercent } from "@/lib/format"

type PresenceRangeId = (typeof PRESENCE_RANGES)[number]["id"]

export function LocationPerformance({ locationId }: { locationId: string }) {
  const [rangeId, setRangeId] = useState<PresenceRangeId>("28d")
  const overview = useAnalyticsOverview()
  const presence = useAnalyticsPresence({ range: rangeId, locationId })
  const keywords = useAnalyticsKeywords({ range: "6m", locationId })
  const keywordsPaused =
    keywords.error instanceof ApiClientError &&
    keywords.error.code === "keywords_paused"

  return (
    <div className="@container/report flex flex-col gap-(--np-gap-section)">
      {/* Review metrics — filtered from the org-wide overview.locations[] */}
      <section className="flex flex-col gap-3">
        {/* "Review activity" (not "Reviews") — the tile below is literally
            labelled "Reviews"; a heading with identical text would either
            resolve findByText("Reviews") before the query settles, or collide
            with the tile once it has (both break the pinned test). */}
        <SectionHeader title="Review activity" description="Last 30 days" />
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
                  framed
                  variant="empty"
                  title="No review activity"
                  description="This location has no reviews in the last 30 days."
                />
              )
            }
            return (
              <div className={reportTileGridClassName()}>
                <KpiTile label="Reviews" value={formatNumber(row.reviews)} />
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
                  hint="Review received to first reply"
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
              </div>
            )
          })()
        )}
      </section>

      {/* Google visibility — presence scoped by locationId */}
      <section className="flex flex-col gap-3">
        <SectionHeader
          title="Visibility on Google"
          actions={
            <RangeSelect
              value={rangeId}
              onChange={setRangeId}
              options={PRESENCE_RANGES}
            />
          }
        />
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
            framed
            variant="off"
            title="Not switched on"
            description="Visibility metrics are not switched on for your account yet."
          />
        ) : presence.data.state === "no_link" ? (
          <ReportingPanel
            framed
            variant="empty"
            icon={<Link2OffIcon />}
            title="Not linked"
            description="This location is not linked to Google."
          />
        ) : presence.data.state === "pending" ? (
          <ReportingPanel framed variant="collecting" />
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
            variant="empty"
            title="No visibility data yet"
            description="Google has not reported visibility data for this window."
          />
        ) : (
          <>
            <FetchedAtCaption
              iso={presence.data.freshThrough}
              timezone="UTC"
              prefix="Google figures as at"
            />
            <UnavailableAlert
              codes={presence.data.unavailableReasons}
              title="Some figures could not be refreshed"
            />
            <PresenceFigures data={presence.data} />
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
              variant="paused"
              title="Keyword reporting is paused"
              description="Google search-keyword reporting is temporarily paused."
            />
          ) : (
            <ReportingPanel
              variant="error"
              onRetry={() => void keywords.refetch()}
            />
          )
        ) : keywords.data.keywords.length === 0 ? (
          <ReportingPanel
            framed
            variant="empty"
            icon={<SearchIcon />}
            title="No keywords yet"
            description="Google has not reported any search keywords for this location."
          />
        ) : (
          <KeywordsTable keywords={keywords.data.keywords.slice(0, 20)} />
        )}
      </section>
    </div>
  )
}
