"use client"

import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { KpiTile } from "@/components/ui/kpi-tile"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import type { ListingSummary } from "@/lib/contracts/location-summary"
import { formatRelativeTime } from "@/lib/format"
import { googleChangedCount, unpublishedCount } from "@/lib/listings/health"
import { listingHref } from "@/lib/listings/areas"

/**
 * Four facts about the listing that decide what to do next: whether Google
 * is reachable, whether Google trusts the listing, whether what is here
 * matches what is there, and when anything last went out. Each tile's
 * action is the one fix for its problem.
 */
function HealthStrip({
  locationId,
  linked,
  clientId,
  summary,
  canManageConsoles,
}: {
  locationId: string
  linked: boolean
  clientId: string | null
  summary: ListingSummary | undefined
  canManageConsoles: boolean
}) {
  if (!summary) {
    return (
      <div
        aria-busy="true"
        className="grid gap-(--np-gap-card) sm:grid-cols-2 xl:grid-cols-4"
      >
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-24 rounded-(--np-radius-card)" />
        ))}
      </div>
    )
  }

  const connection = summary.connection
  const connectionBroken =
    !linked ||
    !connection ||
    connection.status !== "active" ||
    connection.reconnectRequired
  const unpublished = unpublishedCount(summary)
  const changed = googleChangedCount(summary)

  return (
    <div className="grid gap-(--np-gap-card) sm:grid-cols-2 xl:grid-cols-4">
      <KpiTile
        label="Google connection"
        value={
          !linked ? (
            <StatusPill tone="neutral">Not linked</StatusPill>
          ) : connectionBroken ? (
            <StatusPill tone="at-risk">Needs reconnecting</StatusPill>
          ) : (
            <StatusPill tone="healthy">Connected</StatusPill>
          )
        }
        hint={
          connection?.googleEmail ??
          (linked ? "No login on record" : "Link it from the client's setup")
        }
        trailing={
          linked && connectionBroken && clientId && canManageConsoles ? (
            <Link
              href={`/setup?client=${clientId}&step=connect`}
              className={buttonVariants({
                variant: "tinted",
                size: "xs",
                pill: true,
              })}
            >
              Reconnect
            </Link>
          ) : undefined
        }
      />
      <KpiTile
        label="Verification"
        value={
          summary.verified ? (
            <StatusPill tone="healthy">Verified</StatusPill>
          ) : linked ? (
            <StatusPill tone="pending">Not verified</StatusPill>
          ) : (
            <StatusPill tone="neutral">—</StatusPill>
          )
        }
        hint={
          summary.verified
            ? "Google trusts this listing"
            : "Some changes will not show until Google verifies it"
        }
        trailing={
          linked && !summary.verified && canManageConsoles ? (
            <Link
              href={listingHref(locationId, "verification")}
              className={buttonVariants({
                variant: "tinted",
                size: "xs",
                pill: true,
              })}
            >
              Verify
            </Link>
          ) : undefined
        }
      />
      <KpiTile
        label="Sync with Google"
        value={
          unpublished === 0 && changed === 0 ? (
            <StatusPill tone="healthy">In sync</StatusPill>
          ) : (
            <span className="flex flex-wrap gap-1.5">
              {unpublished > 0 ? (
                <StatusPill tone="pending">
                  {unpublished === 1
                    ? "1 to publish"
                    : `${unpublished} to publish`}
                </StatusPill>
              ) : null}
              {changed > 0 ? (
                <StatusPill tone="attention">
                  {changed === 1
                    ? "1 Google change"
                    : `${changed} Google changes`}
                </StatusPill>
              ) : null}
            </span>
          )
        }
        hint={
          unpublished > 0
            ? "Saved here, not yet on Google"
            : changed > 0
              ? "Google changed something since the last publish"
              : "What is here matches what customers see"
        }
        trailing={
          unpublished > 0 ? (
            <Link
              href={listingHref(locationId, "changes")}
              className={buttonVariants({ size: "xs", pill: true })}
            >
              Review & publish
            </Link>
          ) : changed > 0 ? (
            <Link
              href={listingHref(locationId, "suggestions")}
              className={buttonVariants({
                variant: "tinted",
                size: "xs",
                pill: true,
              })}
            >
              Review
            </Link>
          ) : undefined
        }
      />
      <KpiTile
        label="Last published"
        value={
          summary.lastPublish ? (
            <span className="text-title font-semibold">
              {formatRelativeTime(summary.lastPublish.at)}
            </span>
          ) : (
            <span className="text-title font-semibold text-ink-muted">
              Never
            </span>
          )
        }
        hint={
          summary.lastPublish
            ? summary.lastPublish.status === "failed"
              ? `The last ${summary.lastPublish.area} publish failed`
              : summary.lastPublish.status === "in_progress"
                ? `A ${summary.lastPublish.area} publish is in progress`
                : `Last change: ${summary.lastPublish.area}`
            : "Nothing has been published from here yet"
        }
        trailing={
          summary.lastPublish?.status === "failed" ? (
            <StatusPill tone="at-risk">Failed</StatusPill>
          ) : undefined
        }
      />
    </div>
  )
}

export { HealthStrip }
