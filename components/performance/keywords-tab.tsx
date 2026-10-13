"use client"

import { Link2OffIcon, SearchIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { CsvDownloadButton } from "@/components/reporting/csv-download-button"
import {
  PartialCoverageAlert,
  RefreshFailedNote,
} from "@/components/reporting/partial-coverage-alert"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { ReportTabHead } from "@/components/reporting/report-tab-head"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { UnavailableAlert } from "@/components/reporting/unavailable-alert"
import {
  keywordsCsv,
  KeywordsTable,
} from "@/components/performance/keywords-table"
import { RefreshGoogleButton } from "@/components/performance/refresh-google-button"
import { Input } from "@/components/ui/input"
import { ApiClientError } from "@/lib/api/client"
import { formatNumber } from "@/lib/format"
import { useAnalyticsKeywords } from "@/lib/queries/use-analytics-keywords"
import { csvFilename } from "@/lib/reporting/csv"
import {
  DEFAULT_RANGES,
  KEYWORD_RANGES,
  type KeywordRangeId,
} from "@/lib/reporting/ranges"
import { canTriggerSync } from "@/lib/reporting/sync-permission"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"

/**
 * Search keywords for the page's scope and period. The period is chosen in
 * the page's ReportToolbar (`?range=`).
 */
export function KeywordsTab({
  clientId,
  range,
}: {
  clientId?: string
  /** The period (from `?range=`); the keywords default when absent. */
  range?: KeywordRangeId
}) {
  const rangeId = range ?? DEFAULT_RANGES.keywords
  const [query, setQuery] = useState("")
  const role = useSessionRole()
  const keywords = useAnalyticsKeywords({ range: rangeId, clientId })
  const paused =
    keywords.isError &&
    keywords.error instanceof ApiClientError &&
    keywords.error.code === "keywords_paused"
  const rangeLabel =
    KEYWORD_RANGES.find((option) => option.id === rangeId)?.label ?? ""

  const header = (
    <ReportTabHead
      caption={
        !keywords.data ? null : (
          <FetchedAtCaption
            iso={keywords.data?.from ?? null}
            timezone="UTC"
            prefix="Impressions since"
          />
        )
      }
      controls={
        // Owners and admins only; and not while paused, which is switched
        // off on purpose, so a refresh cannot help.
        canTriggerSync(role) && !paused ? (
          <RefreshGoogleButton
            kind="keywords"
            canTrigger
            onDone={() => void keywords.refetch()}
          />
        ) : null
      }
    />
  )

  const frame = (body: React.ReactNode) => (
    <div className="@container/report flex flex-col gap-(--np-gap-section)">
      {/* Leading h2 keeps heading order valid when deep-linked via ?tab=keywords (REV-2). */}
      <h2 className="sr-only">Search keywords</h2>
      {header}
      {body}
    </div>
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
    return frame(<ReportingPanel variant="loading" title="Loading keywords…" />)
  }

  const data = keywords.data
  const note = (
    <Alert variant="info">
      <AlertTitle>How Google counts these</AlertTitle>
      <AlertDescription>
        A “+” means Google reports at least this many impressions (it gives a
        range for lower-volume terms).
      </AlertDescription>
    </Alert>
  )

  if (data.state === "no_link")
    return frame(
      <ReportingPanel
        framed
        titleAs="h3"
        variant="empty"
        icon={<Link2OffIcon />}
        title="No linked location"
        description="Connect a Google location to see the searches that surface it."
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
        <PartialCoverageAlert completeness={data.completeness} />
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
          title="Some keywords could not be refreshed"
        >
          <RefreshFailedNote completeness={data.completeness} />
        </UnavailableAlert>
        <PartialCoverageAlert
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
        {note}
        <PartialCoverageAlert completeness={data.completeness} />
        <ReportingPanel
          framed
          titleAs="h3"
          variant="empty"
          icon={<SearchIcon />}
          title="No keywords yet"
          description="Google has not reported any search keywords for this window."
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
      {note}
      {/* Partial data: ready, with some locations' last refresh failing. */}
      <UnavailableAlert
        codes={data.unavailableReasons}
        title="Some keywords could not be refreshed"
      >
        <RefreshFailedNote completeness={data.completeness} />
      </UnavailableAlert>
      <PartialCoverageAlert
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
            filename={csvFilename("search keywords", rangeLabel)}
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
          icon={<SearchIcon />}
          title="No terms match this filter"
          description="Clear the filter to see every term."
        />
      ) : (
        <KeywordsTable keywords={shown} />
      )}
    </>
  )
}
