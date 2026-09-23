"use client"

import { ExternalLinkIcon, RefreshCwIcon, UploadIcon } from "lucide-react"
import Link from "next/link"

import { PageFrame } from "@/components/app-shell/page-frame"
import { ActivityDrawer } from "@/components/editors/activity-drawer"
import { ListingAreaHeader } from "@/components/listings/area-frame"
import { AreaCards } from "@/components/listings/area-cards"
import { FileUnderClient } from "@/components/listings/file-under-client"
import { HealthStrip } from "@/components/listings/health-strip"
import { ListingGate } from "@/components/listings/listing-gate"
import { RecentActivity } from "@/components/listings/recent-activity"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { SectionHeader } from "@/components/ui/section-header"
import { StatusPill } from "@/components/ui/status-pill"
import type { ListingSummary } from "@/lib/contracts/location-summary"
import { formatRelativeTime } from "@/lib/format"
import {
  listingHealth,
  listingHealthDescription,
  listingHealthLabel,
  listingHealthTone,
  unpublishedCount,
} from "@/lib/listings/health"
import { uncheckedAreas } from "@/lib/listings/area-state"
import { areaForSegment, listingHref } from "@/lib/listings/areas"
import { formatAddressLine } from "@/lib/locations/address"
import type { DirectoryEntry } from "@/lib/queries/use-locations"
import { useListingSummary } from "@/lib/queries/use-listing-summary"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { cn } from "@/lib/utils"

const OPEN_ON_GOOGLE_REASON =
  "Google’s public link for this listing isn’t in NabaPresence’s saved data, so there is nothing to open yet."

/**
 * The notes that decide what to do before anything else: a listing with no
 * client, one Google has not verified, a publish that failed, a summary that
 * did not load. Each names its fix.
 */
function OverviewAlerts({
  entry,
  locationId,
  summary,
  summaryFailed,
  onRetrySummary,
  canManage,
}: {
  entry: DirectoryEntry
  locationId: string
  summary: ListingSummary | undefined
  summaryFailed: boolean
  onRetrySummary: () => void
  canManage: boolean
}) {
  const disconnected = Boolean(
    summary?.connection &&
    (summary.connection.status !== "active" ||
      summary.connection.reconnectRequired)
  )
  const failed =
    summary?.lastPublish?.status === "failed" ? summary.lastPublish : null
  const failedArea = failed ? areaForSegment(failed.area) : undefined
  const unverified =
    entry.linked && summary !== undefined && !summary.verified && !disconnected

  const alerts: React.ReactNode[] = []

  if (!entry.clientId) {
    alerts.push(
      <Alert key="unfiled" variant="warning" data-slot="unfiled-alert">
        <AlertTitle>This listing isn’t filed under a client</AlertTitle>
        <AlertDescription>
          It won’t appear on a client page or in client reports until it is.
          {canManage ? null : " An owner or admin can file it."}
        </AlertDescription>
        {canManage ? (
          <AlertActions>
            <FileUnderClient
              locationId={locationId}
              locationName={entry.name}
            />
          </AlertActions>
        ) : null}
      </Alert>
    )
  }

  if (unverified) {
    alerts.push(
      <Alert key="verify" variant="info">
        <AlertTitle>Google hasn’t verified this listing</AlertTitle>
        <AlertDescription>
          Some changes won’t show to customers until Google verifies it.
        </AlertDescription>
        {canManage ? (
          <AlertActions>
            <Link
              href={listingHref(locationId, "verification")}
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" })
              )}
            >
              Start verification
            </Link>
          </AlertActions>
        ) : null}
      </Alert>
    )
  }

  if (failed) {
    alerts.push(
      <Alert key="failed" variant="destructive">
        <AlertTitle>
          The last {failed.area} publish failed ·{" "}
          {formatRelativeTime(failed.at)}
        </AlertTitle>
        <AlertDescription>
          Nothing from that attempt is on Google. The saved copy here is kept,
          and Activity has Google’s reason.
        </AlertDescription>
        {failedArea ? (
          <AlertActions>
            <Link
              href={listingHref(locationId, failedArea.segment)}
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" })
              )}
            >
              Open {failedArea.label.toLowerCase()}
            </Link>
          </AlertActions>
        ) : null}
      </Alert>
    )
  }

  if (summaryFailed) {
    alerts.push(
      <Alert key="summary" variant="warning">
        <AlertTitle>We couldn’t check where each area stands</AlertTitle>
        <AlertDescription>
          The listing summary didn’t load, so each area shows “Open to check”
          instead of its status. Opening an area reads it directly.
        </AlertDescription>
        <AlertActions>
          <Button variant="secondary" size="sm" onClick={onRetrySummary}>
            <RefreshCwIcon aria-hidden />
            Try again
          </Button>
        </AlertActions>
      </Alert>
    )
  }

  if (alerts.length === 0) return null
  return <div className="flex flex-col gap-2.5">{alerts}</div>
}

/**
 * One listing's home: what state it is in, which area needs someone, and
 * what last went to Google. Everything here paints from DB-only reads; the
 * editors are where Google is read, and they are one click away.
 */
function ListingOverview({
  locationId,
  role,
}: {
  locationId: string
  role: string | null
}) {
  const canManageConsoles = role === "owner" || role === "admin"
  const summary = useListingSummary(locationId)
  const caps = useLocationCapabilities(locationId)

  return (
    <ListingGate locationId={locationId} role={role}>
      {(entry) => {
        const health = listingHealth({
          linked: entry.linked,
          verified: entry.verified ?? summary.data?.verified,
          summary: summary.data,
        })
        const pending = summary.data ? unpublishedCount(summary.data) : 0
        const address = formatAddressLine(entry.address)
        const summaryFailed = summary.isError && !summary.data
        const disconnected = health === "disconnected"
        return (
          <PageFrame width="wide">
            <ListingAreaHeader
              entry={entry}
              role={role}
              locationId={locationId}
              current="overview"
              summary={summary.data}
              status={
                summary.data || !entry.linked ? (
                  <StatusPill tone={listingHealthTone(health)}>
                    {listingHealthLabel(health)}
                  </StatusPill>
                ) : summaryFailed ? null : undefined
              }
              description={
                <>
                  {summary.data || !entry.linked
                    ? health === "healthy" &&
                      summary.data &&
                      uncheckedAreas(summary.data).length > 0
                      ? "Nothing is waiting. Some areas haven’t been compared with Google yet."
                      : listingHealthDescription(health)
                    : null}
                  {address ? ` ${address}.` : ""}
                </>
              }
              actions={
                <>
                  {pending > 0 && !disconnected ? (
                    <Link
                      href={listingHref(locationId, "changes")}
                      className={cn(
                        buttonVariants({
                          className: "max-sm:col-span-2",
                        })
                      )}
                    >
                      <UploadIcon aria-hidden strokeWidth={1.75} />
                      Review & publish ({pending})
                    </Link>
                  ) : null}
                  <ActivityDrawer locationId={locationId} />
                  <Button
                    variant="secondary"
                    disabledReason={OPEN_ON_GOOGLE_REASON}
                  >
                    <ExternalLinkIcon aria-hidden />
                    Open on Google
                  </Button>
                </>
              }
            />

            <OverviewAlerts
              entry={entry}
              locationId={locationId}
              summary={summary.data}
              summaryFailed={summaryFailed}
              onRetrySummary={() => void summary.refetch()}
              canManage={canManageConsoles}
            />

            <section
              aria-labelledby="listing-health"
              className="flex flex-col gap-3"
            >
              <SectionHeader
                id="listing-health"
                title="Health"
                description={
                  disconnected
                    ? "The connection is broken, so the rest is as of the last sync."
                    : "Four facts that decide what to do next."
                }
              />
              <HealthStrip
                locationId={locationId}
                linked={entry.linked}
                clientId={entry.clientId ?? null}
                summary={summary.data}
                summaryFailed={summaryFailed}
                canManageConsoles={canManageConsoles}
              />
            </section>

            <section
              aria-labelledby="listing-areas"
              className="flex flex-col gap-3"
            >
              <SectionHeader
                id="listing-areas"
                title="Areas"
                description="Where each part of the listing stands. Open one to edit it."
              />
              <AreaCards
                locationId={locationId}
                linked={entry.linked}
                summary={summary.data}
                summaryFailed={summaryFailed}
                caps={caps.data}
                canManageConsoles={canManageConsoles}
              />
            </section>

            <section
              aria-labelledby="listing-activity"
              className="flex flex-col gap-3"
            >
              <SectionHeader
                id="listing-activity"
                title="Recent activity"
                description="The last five things sent to Google from here, newest first."
              />
              <div className="rounded-(--np-radius-card) border border-line bg-surface px-4 py-3">
                <RecentActivity locationId={locationId} />
              </div>
            </section>
          </PageFrame>
        )
      }}
    </ListingGate>
  )
}

export { ListingOverview }
