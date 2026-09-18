"use client"

import { useState } from "react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { RangeSelect } from "@/components/performance/range-select"
import { RefreshGoogleButton } from "@/components/performance/refresh-google-button"
import { ApiClientError } from "@/lib/api/client"
import { useAnalyticsKeywords } from "@/lib/queries/use-analytics-keywords"
import { formatKeywordImpressions } from "@/lib/reporting/keyword-impressions"
import { humaniseUnavailableReasons } from "@/lib/reporting/unavailable-reasons"
import { KEYWORD_RANGES } from "@/lib/reporting/ranges"
import { canTriggerSync } from "@/lib/reporting/sync-permission"
import { useSessionRole } from "@/lib/queries/use-session"

type KeywordRangeId = (typeof KEYWORD_RANGES)[number]["id"]

export function KeywordsTab({ clientId }: { clientId?: string }) {
  const [rangeId, setRangeId] = useState<KeywordRangeId>("6m")
  const role = useSessionRole()
  const keywords = useAnalyticsKeywords({ range: rangeId, clientId })

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <FetchedAtCaption
        iso={keywords.data?.from ?? null}
        timezone="UTC"
        prefix="Impressions since"
        pending={keywords.isPending}
      />
      <div className="flex flex-wrap items-center gap-2">
        <RangeSelect
          value={rangeId}
          onChange={setRangeId}
          options={KEYWORD_RANGES}
          label="Keyword range"
        />
        <RefreshGoogleButton
          kind="keywords"
          canTrigger={canTriggerSync(role)}
          onDone={() => void keywords.refetch()}
        />
      </div>
    </div>
  )

  // The route throws 503 keywords_paused before parsing when the flag is off.
  if (keywords.isError) {
    const paused =
      keywords.error instanceof ApiClientError &&
      keywords.error.code === "keywords_paused"
    return (
      <div className="flex flex-col gap-(--np-gap-section)">
        {header}
        {paused ? (
          <ReportingPanel
            variant="paused"
            title="Keyword reporting is paused"
            description="Google search-keyword reporting is on hold for now. Please check back soon."
          />
        ) : (
          <ReportingPanel
            variant="error"
            onRetry={() => void keywords.refetch()}
          />
        )}
      </div>
    )
  }

  if (keywords.isPending) {
    return (
      <div className="flex flex-col gap-(--np-gap-section)">
        {header}
        <ReportingPanel variant="loading" title="Loading keywords…" />
      </div>
    )
  }

  const data = keywords.data
  const reasons = humaniseUnavailableReasons(data.unavailableReasons)

  const body =
    data.state === "no_link" ? (
      <ReportingPanel
        variant="empty"
        title="No linked location"
        description="Connect a Google location to see the searches that surface it."
      />
    ) : data.state === "pending" ? (
      // NOT `loading`: this response has already arrived. "pending" is the
      // server saying Google has not reported anything for this window yet
      // (app/api/analytics/presence/route.ts), so a skeleton here would spin
      // until the operator gave up and reloaded.
      <ReportingPanel variant="collecting" />
    ) : data.state === "unavailable" ? (
      <Alert variant="warning">
        <AlertTitle>Some keywords could not be refreshed</AlertTitle>
        <AlertDescription>
          {reasons[0] ?? "We will retry automatically."}
        </AlertDescription>
      </Alert>
    ) : data.keywords.length === 0 ? (
      <ReportingPanel
        variant="empty"
        title="No keywords yet"
        description="Google has not reported any search keywords for this window."
      />
    ) : (
      <Table surface>
        <TableHeader>
          <TableRow>
            <TableHead numeric className="w-12">
              #
            </TableHead>
            <TableHead>Search term</TableHead>
            <TableHead numeric>Impressions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.keywords.map((keyword) => (
            <TableRow key={`${keyword.rank}-${keyword.keyword}`}>
              <TableCell numeric className="text-ink-muted">
                {keyword.rank}
              </TableCell>
              <TableCell className="font-medium text-ink" lang="und" dir="auto">
                {keyword.keyword}
              </TableCell>
              <TableCell numeric>{formatKeywordImpressions(keyword)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )

  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      {/* Leading h2 keeps heading order valid when deep-linked via ?tab=keywords (REV-2). */}
      <h2 className="sr-only">Search keywords</h2>
      {header}
      <p className="text-caption text-ink-muted">
        A “+” means Google reports at least this many impressions (it gives a
        range for lower-volume terms).
      </p>
      {body}
    </div>
  )
}
