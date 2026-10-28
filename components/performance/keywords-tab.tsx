"use client"

import { Link2OffIcon, SearchIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import { EmptyIllustration } from "@/components/ui/empty"
import {
  CsvDownloadButton,
  ReportExportScope,
} from "@/components/reporting/csv-download-button"
import {
  PartialCoverageAlert,
  RefreshFailedNote,
} from "@/components/reporting/partial-coverage-alert"
import { ReportTabHead } from "@/components/reporting/report-tab-head"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { UnavailableAlert } from "@/components/reporting/unavailable-alert"
import {
  keywordsCsv,
  KeywordsTable,
} from "@/components/performance/keywords-table"
import {
  RefreshStatus,
  useRefreshWatch,
} from "@/components/performance/refresh-google-button"
import {
  ReportActionsMenu,
  type ReportShareTarget,
} from "@/components/reporting/report-actions-menu"
import { ReportsSkeleton } from "@/components/reporting/reports-skeleton"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { ApiClientError } from "@/lib/api/client"
import { formatNumber } from "@/lib/format"
import { useAnalyticsKeywords } from "@/lib/queries/use-analytics-keywords"
import { csvFilename } from "@/lib/reporting/csv"
import { DEFAULT_RANGES, type KeywordRangeId } from "@/lib/reporting/ranges"
import { canTriggerSync } from "@/lib/reporting/sync-permission"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"
import { LISTING_TERMS } from "@/lib/workspace/terms"

/** "March 2026": Keywords count whole months, so the caption names one. */
const MONTH = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

/**
 * Search keywords for the page's scope and period. The period is chosen in
 * the page's period strip or toolbar (`?range_kw=`); `onRangeChange` is
 * still used for the "Show the last 12 months" shortcut on a quiet period.
 */
export function KeywordsTab({
  clientId,
  range,
  onRangeChange,
  share,
}: {
  clientId?: string
  /** What the report's menu shares; none when the viewer may not share. */
  share?: ReportShareTarget | null
  /** The period (from `?range=`); the keywords default when absent. */
  range?: KeywordRangeId
  onRangeChange?: (range: KeywordRangeId) => void
}) {
  const rangeId = range ?? DEFAULT_RANGES.keywords
  const [query, setQuery] = useState("")
  const role = useSessionRole()
  const keywords = useAnalyticsKeywords({ range: rangeId, clientId })
  // A refresh is followed until the terms on screen change.
  const refresh = useRefreshWatch(
    "keywords",
    keywords.data
      ? keywords.data.keywords
          .map((term) => `${term.keyword}:${term.impressions}`)
          .join("|")
      : null
  )
  const paused =
    keywords.isError &&
    keywords.error instanceof ApiClientError &&
    keywords.error.code === "keywords_paused"
  const countedFrom =
    keywords.data &&
    (keywords.data.state === "ready" || keywords.data.state === "empty") &&
    Number.isFinite(Date.parse(keywords.data.from))
      ? MONTH.format(new Date(keywords.data.from))
      : null

  const canRefresh = canTriggerSync(role) && !paused
  const header = (
    <ReportTabHead
      caption={
        keywords.isPending ? (
          // One caption line once it arrives: keep its room.
          <Skeleton aria-hidden className="h-4 w-48 max-w-full" />
        ) : !countedFrom &&
          !refresh.refreshing &&
          !refresh.stillWaiting ? null : (
          // The month the count starts, only over terms (or their absence)
          // it describes: not over the no-link, collecting or failed panels.
          <>
            {countedFrom ? (
              <p className="text-caption text-ink-muted tabular-nums">
                Times shown in search, counted from {countedFrom}
              </p>
            ) : null}
            {refresh.refreshing || refresh.stillWaiting ? (
              <RefreshStatus stillWaiting={refresh.stillWaiting} />
            ) : null}
          </>
        )
      }
      controls={
        // Refresh is for owners and admins only, and not while paused, which
        // is switched off on purpose, so a refresh cannot help.
        share || canRefresh ? (
          <ReportActionsMenu
            share={share}
            refresh={
              canRefresh
                ? {
                    kind: "keywords",
                    scopedToClient: Boolean(clientId),
                    onStart: refresh.onStart,
                    onFailed: refresh.onFailed,
                    onSettled: refresh.onSettled,
                  }
                : null
            }
          />
        ) : undefined
      }
    />
  )

  const frame = (body: React.ReactNode) => (
    // The CSV file carries the first month counted, after the page's scope.
    <ReportExportScope
      value={{
        period: keywords.data
          ? `from ${keywords.data.from.slice(0, 7)}`
          : undefined,
      }}
    >
      <div className="@container/report flex flex-col gap-(--np-gap-section)">
        {/* Leading h2 keeps heading order valid when deep-linked via ?tab=keywords (REV-2). */}
        <h2 className="sr-only">Search keywords</h2>
        {header}
        {body}
      </div>
    </ReportExportScope>
  )

  // The route throws 503 keywords_paused before parsing when the flag is off.
  if (keywords.isError) {
    return frame(
      paused ? (
        <ReportingPanel
          framed
          titleAs="h3"
          variant="paused"
          title="Keyword reporting is paused"
          description="Google search-keyword reporting is on hold for now. Please check back soon."
        />
      ) : (
        <ReportingPanel
          variant="error"
          cause={keywords.error}
          onRetry={() => void keywords.refetch()}
        />
      )
    )
  }

  if (keywords.isPending) {
    return frame(
      <ReportsSkeleton variant="keywords" label="Loading keywords…" />
    )
  }

  const data = keywords.data
  // How the figures are counted: a footnote under the table, not a box above
  // it that pushes the first search term off a phone's first screen.
  const note = (
    <p className="text-caption text-ink-muted">
      How Google counts these: a “+” means at least this many. Google gives a
      range, not an exact count, for less-searched terms.
    </p>
  )

  if (data.state === "no_link")
    return frame(
      <ReportingPanel
        framed
        titleAs="h3"
        variant="empty"
        icon={<Link2OffIcon />}
        title={`No linked ${LISTING_TERMS.place}`}
        description={`Connect a Google ${LISTING_TERMS.place} to see the searches that surface it.`}
        action={
          <Link
            href={clientId ? `/clients/${clientId}` : "/listings"}
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            {clientId ? "Open this client’s listings" : "Open Listings"}
          </Link>
        }
      />
    )
  if (data.state === "pending")
    // NOT `loading`: this response has already arrived. "pending" is the
    // server saying Google has not reported anything for this window yet
    // (app/api/analytics/presence/route.ts), so a skeleton here would spin
    // until the operator gave up and reloaded.
    return frame(
      <>
        {/* No keywords yet: still name each location and why. */}
        <PartialCoverageAlert compact completeness={data.completeness} />
        <ReportingPanel framed titleAs="h3" variant="collecting" />
      </>
    )
  if (data.state === "unavailable")
    return frame(
      <>
        <UnavailableAlert
          codes={
            data.unavailableReasons.length
              ? data.unavailableReasons
              : ["keyword_sync_failed"]
          }
          // Nothing came back at all here: not "some".
          title="Search keywords could not be refreshed"
        >
          <RefreshFailedNote completeness={data.completeness} />
        </UnavailableAlert>
        <PartialCoverageAlert
          compact
          completeness={data.completeness}
          refreshFailedShownElsewhere
        />
      </>
    )
  // One failure, one warning: the failed locations go into the alert that
  // already says why, when it shows.
  const failureExplained = data.unavailableReasons.length > 0
  if (data.keywords.length === 0)
    return frame(
      <>
        <PartialCoverageAlert compact completeness={data.completeness} />
        <ReportingPanel
          framed
          titleAs="h3"
          variant="empty"
          icon={<SearchIcon />}
          title="No keywords yet"
          description="Google has not reported any search keywords for this period."
          action={
            // A short period on a quiet listing is often empty; a longer one
            // usually is not, and is one press away (as on the Google tab).
            onRangeChange && (rangeId === "1m" || rangeId === "6m") ? (
              <Button variant="secondary" onClick={() => onRangeChange("12m")}>
                Show the last 12 months
              </Button>
            ) : undefined
          }
        />
      </>
    )

  const needle = query.trim().toLocaleLowerCase("en-GB")
  const shown = needle
    ? data.keywords.filter((keyword) =>
        keyword.keyword.toLocaleLowerCase("en-GB").includes(needle)
      )
    : data.keywords

  return frame(
    <>
      {/* Partial data: ready, with some locations' last refresh failing. */}
      <UnavailableAlert
        codes={data.unavailableReasons}
        title="Some keywords could not be refreshed"
      >
        <RefreshFailedNote completeness={data.completeness} />
      </UnavailableAlert>
      <PartialCoverageAlert
        compact
        completeness={data.completeness}
        refreshFailedShownElsewhere={failureExplained}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          placeholder="Filter search terms"
          aria-label="Filter search terms"
          className="w-full sm:w-80"
        />
        <p
          aria-live="polite"
          className="text-caption text-ink-muted tabular-nums"
        >
          {formatNumber(shown.length)} of {formatNumber(data.keywords.length)}{" "}
          terms
        </p>
        <span className="ml-auto print:hidden">
          <CsvDownloadButton
            // A filtered export says so in its name, as the button's
            // accessible name says "of the search terms shown".
            filename={csvFilename(
              needle ? "search keywords filtered" : "search keywords"
            )}
            subject="the search terms shown"
            rows={() => keywordsCsv(shown)}
          />
        </span>
      </div>
      {shown.length === 0 ? (
        <ReportingPanel
          framed
          titleAs="h3"
          variant="empty"
          // A filter that matched nothing: NM's search-with-no-results
          // drawing, in place of the glyph.
          illustration={<EmptyIllustration name="search" />}
          title="No terms match this filter"
          description="Clear the filter to see every term."
        />
      ) : (
        <KeywordsTable keywords={shown} />
      )}
      {note}
    </>
  )
}
