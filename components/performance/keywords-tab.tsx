"use client"

import { Link2OffIcon, SearchIcon } from "lucide-react"
import { useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { ReportTabHead } from "@/components/reporting/report-tab-head"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { UnavailableAlert } from "@/components/reporting/unavailable-alert"
import { KeywordsTable } from "@/components/performance/keywords-table"
import { RangeSelect } from "@/components/performance/range-select"
import { RefreshGoogleButton } from "@/components/performance/refresh-google-button"
import { Input } from "@/components/ui/input"
import { ApiClientError } from "@/lib/api/client"
import { formatNumber } from "@/lib/format"
import { useAnalyticsKeywords } from "@/lib/queries/use-analytics-keywords"
import { KEYWORD_RANGES } from "@/lib/reporting/ranges"
import { canTriggerSync } from "@/lib/reporting/sync-permission"
import { useSessionRole } from "@/lib/queries/use-session"

type KeywordRangeId = (typeof KEYWORD_RANGES)[number]["id"]

export function KeywordsTab({ clientId }: { clientId?: string }) {
  const [rangeId, setRangeId] = useState<KeywordRangeId>("6m")
  const [query, setQuery] = useState("")
  const role = useSessionRole()
  const keywords = useAnalyticsKeywords({ range: rangeId, clientId })
  const paused =
    keywords.isError &&
    keywords.error instanceof ApiClientError &&
    keywords.error.code === "keywords_paused"

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
        <>
          <RangeSelect
            value={rangeId}
            onChange={setRangeId}
            options={KEYWORD_RANGES}
          />
          {/* Paused is switched off on purpose: a refresh cannot help. */}
          <RefreshGoogleButton
            kind="keywords"
            canTrigger={canTriggerSync(role) && !paused}
            onDone={() => void keywords.refetch()}
          />
        </>
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
          variant="paused"
          title="Keyword reporting is paused"
          description="Google search-keyword reporting is on hold for now. Please check back soon."
        />
      ) : (
        <ReportingPanel
          variant="error"
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
        variant="empty"
        icon={<Link2OffIcon />}
        title="No linked location"
        description="Connect a Google location to see the searches that surface it."
      />
    )
  if (data.state === "pending")
    // NOT `loading`: this response has already arrived. "pending" is the
    // server saying Google has not reported anything for this window yet
    // (app/api/analytics/presence/route.ts), so a skeleton here would spin
    // until the operator gave up and reloaded.
    return frame(<ReportingPanel framed variant="collecting" />)
  if (data.state === "unavailable")
    return frame(
      <UnavailableAlert
        codes={
          data.unavailableReasons.length
            ? data.unavailableReasons
            : ["keyword_sync_failed"]
        }
        title="Some keywords could not be refreshed"
      />
    )
  if (data.keywords.length === 0)
    return frame(
      <>
        {note}
        <ReportingPanel
          framed
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
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          placeholder="Filter search terms"
          aria-label="Filter search terms"
          className="w-full max-w-80 flex-[1_1_14rem]"
        />
        <p
          aria-live="polite"
          className="font-mono text-caption text-ink-muted tabular-nums"
        >
          {formatNumber(shown.length)} of {formatNumber(data.keywords.length)}{" "}
          terms
        </p>
      </div>
      {shown.length === 0 ? (
        <ReportingPanel
          framed
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
