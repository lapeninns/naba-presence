"use client"

import { Link2OffIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import {
  PartialCoverageAlert,
  RefreshFailedNote,
} from "@/components/reporting/partial-coverage-alert"
import { PresenceCaption } from "@/components/reporting/presence-provenance"
import {
  ReportActionsMenu,
  type ReportShareTarget,
} from "@/components/reporting/report-actions-menu"
import { ReportTabHead } from "@/components/reporting/report-tab-head"
import {
  ReportingPanel,
  StaleFiguresAlert,
} from "@/components/reporting/reporting-states"
import { ReportExportScope } from "@/components/reporting/csv-download-button"
import { UnavailableAlert } from "@/components/reporting/unavailable-alert"
import { PresenceFigures } from "@/components/performance/presence-figures"
import {
  RefreshStatus,
  useRefreshWatch,
} from "@/components/performance/refresh-google-button"
import { ReportsSkeleton } from "@/components/reporting/reports-skeleton"
import { Button, buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAnalyticsPresence } from "@/lib/queries/use-analytics-presence"
import {
  DEFAULT_RANGES,
  formatPeriod,
  isValidPeriod,
  resolvedPeriod,
  type PresenceRangeId,
} from "@/lib/reporting/ranges"
import { canTriggerSync } from "@/lib/reporting/sync-permission"
import { useSessionRole } from "@/lib/queries/use-session" // client session hook (Task 1, REV-1)
import { cn } from "@/lib/utils"
import { LISTING_TERMS } from "@/lib/workspace/terms"

/**
 * Google performance for the page's scope and period. The period is chosen
 * in the page's period strip or toolbar (`?range=`); `onRangeChange` is
 * still used for the "Show the last 12 months" shortcut on an empty window.
 */
export function GooglePerformanceTab({
  clientId,
  range,
  onRangeChange,
  share,
}: {
  clientId?: string
  /** What the report's menu shares; none when the viewer may not share. */
  share?: ReportShareTarget | null
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
  // A refresh is followed until the fetch times (or the data) change.
  const refresh = useRefreshWatch(
    "performance",
    presence.data
      ? [
          presence.data.fetchedAt?.oldest,
          presence.data.fetchedAt?.newest,
          presence.data.freshThrough,
        ].join("|")
      : null
  )
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

  // With Google performance switched off for this deployment the server
  // refuses a refresh (503), so it is not offered, as Keywords does when
  // paused.
  const canRefresh =
    canTriggerSync(role) && presence.data?.ingestionEnabled !== false
  const header = (
    <ReportTabHead
      caption={
        presence.isPending ? (
          // One caption line once it arrives: keep its room so the tiles do
          // not drop when it appears.
          <Skeleton aria-hidden className="h-4 w-56 max-w-full" />
        ) : !presence.data?.freshThrough &&
          !refresh.refreshing &&
          !refresh.stillWaiting ? null : (
          // Only a real "as at" date: with nothing collected the panel below
          // already says so, and the caption would repeat it word for word.
          <>
            {presence.data?.freshThrough ? (
              <PresenceCaption data={presence.data} />
            ) : null}
            {refresh.refreshing || refresh.stillWaiting ? (
              <RefreshStatus stillWaiting={refresh.stillWaiting} />
            ) : null}
          </>
        )
      }
      controls={
        // Refresh is owners' and admins' only (lib/reporting/sync-permission);
        // for everyone else it is not in the menu at all.
        share || canRefresh ? (
          <ReportActionsMenu
            share={share}
            refresh={
              canRefresh
                ? {
                    kind: "performance",
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
    // The CSV files carry the server's dates, after the page's scope.
    <ReportExportScope
      value={{
        period: presence.data
          ? `${presence.data.from} ${presence.data.to}`
          : undefined,
      }}
    >
      <div className="@container/report flex flex-col gap-(--np-gap-section)">
        {/* Leading h2 keeps heading order valid before the chart h3s (REV-2). */}
        <h2 className="sr-only">Google performance</h2>
        {header}
        {/* A failed re-read keeps the figures, said to be the last load. */}
        {presence.isError && presence.data ? (
          <StaleFiguresAlert
            cause={presence.error}
            retrying={presence.isFetching}
            onRetry={() => void presence.refetch()}
          />
        ) : null}
        {body}
      </div>
    </ReportExportScope>
  )

  if (presence.isPending)
    return frame(
      <ReportsSkeleton variant="google" label="Loading visibility figures…" />
    )
  // Not pending and nothing to show: the first load failed.
  if (!presence.data)
    return frame(
      <ReportingPanel
        variant="error"
        cause={presence.error}
        onRetry={() => void presence.refetch()}
      />
    )

  const data = presence.data

  // Off flag wins over state: ingestion is switched off for this
  // deployment (an environment switch), not by anyone in the organisation.
  if (!data.ingestionEnabled)
    return frame(
      <ReportingPanel
        framed
        titleAs="h3"
        variant="off"
        title="Google performance is not switched on"
        description="Google performance reporting is off in NabaPresence for now. It isn’t a setting in your organisation, so there is nothing to change here."
      />
    )
  if (data.state === "no_link")
    return frame(
      <ReportingPanel
        framed
        titleAs="h3"
        variant="empty"
        icon={<Link2OffIcon />}
        title={`No linked ${LISTING_TERMS.place}`}
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
    return frame(
      <>
        {/* No figures yet: still name each location and why. */}
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
              : ["performance_sync_failed"]
          }
          // Nothing came back at all here: "some" would contradict the panel.
          title="Google figures could not be refreshed"
        >
          <RefreshFailedNote completeness={data.completeness} />
        </UnavailableAlert>
        <PartialCoverageAlert
          compact
          completeness={data.completeness}
          refreshFailedShownElsewhere
        />
        <ReportingPanel
          framed
          titleAs="h3"
          variant="empty"
          icon={<Link2OffIcon />}
          title="No Google figures for this period"
          description={`Nothing could be refreshed for these ${LISTING_TERMS.placePlural}. The reasons are listed above.`}
        />
      </>
    )
  if (data.state === "empty")
    return frame(
      <>
        <PartialCoverageAlert compact completeness={data.completeness} />
        <ReportingPanel
          framed
          titleAs="h3"
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
      </>
    )

  // One failure, one warning: the failed locations go into the alert that
  // already says why, when it shows.
  const failureExplained = data.unavailableReasons.length > 0
  return frame(
    <>
      {/* Partial data: the report is ready, but some locations' latest
          refresh failed. Named, never counted as zero silently. */}
      <UnavailableAlert
        codes={data.unavailableReasons}
        title="Some figures could not be refreshed"
      >
        <RefreshFailedNote completeness={data.completeness} />
      </UnavailableAlert>
      {/* Expected vs covered: missing locations are named, never zero. */}
      <PartialCoverageAlert
        compact
        completeness={data.completeness}
        refreshFailedShownElsewhere={failureExplained}
      />
      <PresenceFigures data={data} />
    </>
  )
}
