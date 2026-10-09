"use client"

import { Link2OffIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { ReportTabHead } from "@/components/reporting/report-tab-head"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { UnavailableAlert } from "@/components/reporting/unavailable-alert"
import { PresenceFigures } from "@/components/performance/presence-figures"
import { RangeSelect } from "@/components/performance/range-select"
import { RefreshGoogleButton } from "@/components/performance/refresh-google-button"
import { Button, buttonVariants } from "@/components/ui/button"
import { useAnalyticsPresence } from "@/lib/queries/use-analytics-presence"
import {
  DEFAULT_RANGES,
  formatPeriod,
  isValidPeriod,
  PRESENCE_RANGES,
  resolvedPeriod,
  type PresenceRangeId,
} from "@/lib/reporting/ranges"
import { canTriggerSync } from "@/lib/reporting/sync-permission"
import { useSessionRole } from "@/lib/queries/use-session" // client session hook (Task 1, REV-1)
import { cn } from "@/lib/utils"

export function GooglePerformanceTab({
  clientId,
  range,
  onRangeChange,
}: {
  clientId?: string
  /** The period, when the page keeps it (in `?range=`); else kept here. */
  range?: PresenceRangeId
  onRangeChange?: (range: PresenceRangeId) => void
}) {
  const [ownRange, setOwnRange] = useState<PresenceRangeId>(
    DEFAULT_RANGES.google
  )
  const rangeId = range ?? ownRange
  const setRangeId = onRangeChange ?? setOwnRange
  const role = useSessionRole()
  const presence = useAnalyticsPresence({ range: rangeId, clientId })
  // The server's own dates once it answers; the same rule before that.
  const answered = presence.data
    ? { from: presence.data.from, to: presence.data.to }
    : null
  const period = formatPeriod(
    presence.data?.range === rangeId && isValidPeriod(answered)
      ? answered
      : resolvedPeriod("google", rangeId),
    "UTC"
  )

  const header = (
    <ReportTabHead
      caption={
        // Only a real "as at" date: with nothing collected the panel below
        // already says so, and the caption would repeat it word for word.
        !presence.data?.freshThrough ? null : (
          <FetchedAtCaption
            iso={presence.data.freshThrough}
            timezone="UTC"
            prefix="Google figures as at"
          />
        )
      }
      controls={
        <>
          <RangeSelect
            value={rangeId}
            onChange={setRangeId}
            options={PRESENCE_RANGES}
            period={period}
          />
          {/* Owners and admins only (lib/reporting/sync-permission); for
              everyone else the button is not rendered at all. */}
          <RefreshGoogleButton
            kind="performance"
            canTrigger={canTriggerSync(role)}
            onDone={() => void presence.refetch()}
          />
        </>
      }
    />
  )

  const frame = (body: React.ReactNode) => (
    <div className="@container/report flex flex-col gap-(--np-gap-section)">
      {/* Leading h2 keeps heading order valid before the chart h3s (REV-2). */}
      <h2 className="sr-only">Google performance</h2>
      {header}
      {body}
    </div>
  )

  if (presence.isPending)
    return frame(
      <ReportingPanel variant="loading" title="Loading visibility figures…" />
    )
  if (presence.isError)
    return frame(
      <ReportingPanel
        variant="error"
        cause={presence.error}
        onRetry={() => void presence.refetch()}
      />
    )

  const data = presence.data

  // Off flag wins over state: ingestion is switched off for this account.
  if (!data.ingestionEnabled)
    return frame(
      <ReportingPanel
        framed
        variant="off"
        title="Google performance is not switched on"
        description="Ask an admin to turn this on for your organisation."
      />
    )
  if (data.state === "no_link")
    return frame(
      <ReportingPanel
        framed
        variant="empty"
        icon={<Link2OffIcon />}
        title="No linked location"
        description="Link a Google listing to see how it is performing."
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
    return frame(<ReportingPanel framed variant="collecting" />)
  if (data.state === "unavailable")
    return frame(
      <>
        <UnavailableAlert
          codes={
            data.unavailableReasons.length
              ? data.unavailableReasons
              : ["performance_sync_failed"]
          }
          title="Some figures could not be refreshed"
        />
        <ReportingPanel
          framed
          variant="empty"
          icon={<Link2OffIcon />}
          title="No Google figures for this window"
          description="Nothing could be refreshed for these locations. The reasons are listed above."
        />
      </>
    )
  if (data.state === "empty")
    return frame(
      <ReportingPanel
        framed
        variant="empty"
        title="No activity yet"
        description={`Google has not reported any visibility data for ${period}.`}
        action={
          // A short window on a quiet listing is often empty; a longer one
          // usually is not, and is one press away.
          rangeId === "28d" || rangeId === "90d" ? (
            <Button variant="secondary" onClick={() => setRangeId("12m")}>
              Show the last 12 months
            </Button>
          ) : undefined
        }
      />
    )

  return frame(
    <>
      {/* Partial data: the report is ready, but some locations' latest
          refresh failed. Named, never counted as zero silently. */}
      <UnavailableAlert
        codes={data.unavailableReasons}
        title="Some figures could not be refreshed"
      />
      <PresenceFigures data={data} />
    </>
  )
}
