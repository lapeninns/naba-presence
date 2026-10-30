"use client"

import { RefreshCwIcon, UnplugIcon } from "lucide-react"
import Link from "next/link"

import { PageFrame } from "@/components/app-shell/page-frame"
import {
  ListingAreaHeader,
  ReviewPublishLink,
} from "@/components/listings/area-frame"
import { AreaCards } from "@/components/listings/area-cards"
import { CompletenessCard } from "@/components/listings/completeness-card"
import { FileUnderClient } from "@/components/listings/file-under-client"
import { GoogleChangesBadge } from "@/components/listings/google-changes-badge"
import {
  HealthStrip,
  publishAreaName,
} from "@/components/listings/health-strip"
import { ListingGate } from "@/components/listings/listing-gate"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { RelativeTime } from "@/components/ui/relative-time"
import { StatusPill } from "@/components/ui/status-pill"
import type { ListingSummary } from "@/lib/contracts/location-summary"
import {
  listingHealth,
  listingHealthDescription,
  listingHealthLabel,
  listingHealthTone,
} from "@/lib/listings/health"
import { areaForSegment, listingHref } from "@/lib/listings/areas"
import { formatAddressLine } from "@/lib/locations/address"
import type { DirectoryEntry } from "@/lib/queries/use-locations"
import { useListingSummary } from "@/lib/queries/use-listing-summary"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"
import { useNow } from "@/lib/time/server-now"

/**
 * The notes that decide what to do before anything else: a listing Google
 * can't be reached for or that isn't linked, one with no client, one Google
 * has not verified, a publish that failed, a summary that did not load.
 * Each names its fix, and who can make it when the reader can't.
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
  const business = useWorkspaceMode() === "business"
  const disconnected = Boolean(
    summary?.connection &&
    (summary.connection.status !== "active" ||
      summary.connection.reconnectRequired)
  )
  const failed =
    summary?.lastPublish?.status === "failed" ||
    summary?.lastPublish?.status === "ambiguous"
      ? summary.lastPublish
      : null
  const failedArea = failed ? areaForSegment(failed.area) : undefined
  const unverified =
    entry.linked && summary !== undefined && !summary.verified && !disconnected

  const alerts: React.ReactNode[] = []

  // First, because nothing below can be checked or published until it is
  // fixed. Lost access to one listing needs none: the header already says
  // what to do, and the fix is outside this app.
  if (entry.linked && disconnected) {
    alerts.push(
      <Alert
        key="disconnected"
        variant="warning"
        icon={<UnplugIcon aria-hidden />}
        data-slot="connection-alert"
      >
        <AlertTitle>Google can’t be reached for this listing</AlertTitle>
        <AlertDescription>
          {business ? "Your" : "The client’s"} Google login needs reconnecting.
          Until then nothing here is checked against or published to Google;
          saved changes are kept.
          {canManage ? null : " Ask an owner or admin to reconnect it."}
        </AlertDescription>
        {canManage && entry.clientId ? (
          <AlertActions>
            <Link
              href={`/setup?client=${entry.clientId}&step=connect`}
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" })
              )}
            >
              Reconnect Google
            </Link>
          </AlertActions>
        ) : null}
      </Alert>
    )
  }

  if (!entry.linked) {
    alerts.push(
      <Alert key="not-linked" variant="info" data-slot="connection-alert">
        <AlertTitle>This listing isn’t linked to Google</AlertTitle>
        <AlertDescription>
          Its areas stay unavailable until it’s linked to a Google Business
          Profile listing.
          {canManage
            ? entry.clientId
              ? null
              : " File it under a client, then link it from Setup."
            : " An owner or admin can link it from Setup."}
        </AlertDescription>
        {canManage && entry.clientId ? (
          <AlertActions>
            <Link
              href={`/setup?client=${entry.clientId}&step=locations`}
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" })
              )}
            >
              Link to Google
            </Link>
          </AlertActions>
        ) : null}
      </Alert>
    )
  }

  // A business files every listing under its home client, so this never shows.
  if (!entry.clientId && !business) {
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
          {canManage ? null : " An owner or admin can start verification."}
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
      // Page content present on load, not a failure that just happened:
      // no assertive announcement (see `AlertLive`).
      <Alert key="failed" variant="destructive" live={false}>
        <AlertTitle>
          {failed.status === "ambiguous"
            ? "Google hasn’t confirmed the last"
            : "The last"}{" "}
          {publishAreaName(failed.area)}{" "}
          {failed.status === "ambiguous" ? "publish" : "publish failed"} ·{" "}
          <RelativeTime iso={failed.at} />
        </AlertTitle>
        <AlertDescription>
          Some changes may already be on Google. The saved copy here is kept.
          Open the area to compare the current Google listing before trying
          again. Activity, at the top of this page, has the attempt details.
        </AlertDescription>
        {failedArea ? (
          <AlertActions>
            <Link
              href={listingHref(locationId, failedArea.segment)}
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" })
              )}
            >
              Check {failedArea.label.toLowerCase()}
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
 * A section's group label (D8): sentence case, caption, medium, muted, as
 * Notion Mail labels its groups, with the one-line description under it.
 * Still the section's h2, so the regions keep their names.
 */
function SectionLabel({
  id,
  title,
  description,
}: {
  id: string
  title: string
  description: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-1">
      <h2 id={id} className="text-caption font-medium text-ink-muted">
        {title}
      </h2>
      <p className="text-caption text-pretty text-ink-muted">{description}</p>
    </div>
  )
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
  const now = useNow()
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
          now,
        })
        const address = formatAddressLine(entry.address)
        const summaryFailed = summary.isError && !summary.data
        const disconnected = health === "disconnected"
        const mapsUrl = summary.data?.mapsUrl ?? null
        return (
          <PageFrame width="wide">
            <ListingAreaHeader
              entry={entry}
              role={role}
              locationId={locationId}
              current="overview"
              summary={summary.data}
              caps={caps.data}
              // Beside the health pill: "2 changed on Google", linking to
              // the suggestions tab where they are decided. DB only; it
              // renders nothing while loading or when nothing is open.
              status={
                summary.data || !entry.linked ? (
                  <>
                    <StatusPill tone={listingHealthTone(health)}>
                      {listingHealthLabel(health)}
                    </StatusPill>
                    {entry.linked ? (
                      <GoogleChangesBadge locationId={locationId} />
                    ) : null}
                  </>
                ) : summaryFailed ? (
                  <GoogleChangesBadge locationId={locationId} />
                ) : undefined
              }
              description={
                <>
                  {summary.data || !entry.linked
                    ? listingHealthDescription(health)
                    : null}
                  {address ? ` ${address}.` : ""}
                </>
              }
              // Only when Google has given us the listing's Maps link; a
              // button that can never be pressed says nothing.
              links={
                mapsUrl
                  ? [{ label: "Open on Google", href: mapsUrl, external: true }]
                  : []
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

            {/* Below md the header keeps Review & publish in its overflow
                menu; the step the description names stays in sight. */}
            <ReviewPublishLink
              locationId={locationId}
              summary={summary.data}
              caps={caps.data}
              className="w-full md:hidden"
            />

            <section
              aria-labelledby="listing-areas"
              className="flex flex-col gap-2"
            >
              <SectionLabel
                id="listing-areas"
                title="Areas"
                description={
                  caps.data?.canEditCanonical === false
                    ? "Open an area to see what it holds here and on Google."
                    : "Check a problem, review changes or edit an area."
                }
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

            <CompletenessCard
              locationId={locationId}
              linked={entry.linked}
              canManage={canManageConsoles}
            />

            <HealthStrip
              linked={entry.linked}
              summary={summary.data}
              summaryFailed={summaryFailed}
              disconnected={disconnected}
              canManageConsoles={canManageConsoles}
            />
          </PageFrame>
        )
      }}
    </ListingGate>
  )
}

export { ListingOverview }
