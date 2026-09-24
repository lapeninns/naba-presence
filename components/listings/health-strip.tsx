"use client"

import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import type { ListingSummary } from "@/lib/contracts/location-summary"
import { formatNumber, formatRelativeTime } from "@/lib/format"
import { uncheckedAreas } from "@/lib/listings/area-state"
import { googleChangedCount, unpublishedCount } from "@/lib/listings/health"
import { listingHref } from "@/lib/listings/areas"
import { cn } from "@/lib/utils"

const GRID = "grid grid-cols-1 gap-3 @[460px]:grid-cols-2 @[980px]:grid-cols-4"

/**
 * One fact as a tile (reference `.stat.tile`): the question in muted UI
 * text, the answer as status words, one line of detail, and — when there is
 * one — the single fix, at the tile's foot.
 */
function Tile({
  id,
  label,
  value,
  detail,
  action,
}: {
  id: string
  label: string
  value: React.ReactNode
  detail: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div
      data-slot="health-tile"
      data-tile={id}
      className="flex min-w-0 flex-col gap-2 rounded-(--np-radius-card) border border-line bg-surface p-4"
    >
      <p className="text-ui font-medium text-ink-muted">{label}</p>
      <div className="flex min-h-[26px] flex-wrap items-center gap-1.5">
        {value}
      </div>
      <p className="text-caption break-words text-ink-muted">{detail}</p>
      {action ? <div className="mt-auto pt-1">{action}</div> : null}
    </div>
  )
}

function capitalise(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text
}

const ACTION = cn(buttonVariants({ variant: "secondary", size: "sm" }))

/**
 * Four facts about the listing that decide what to do next: whether Google
 * is reachable, whether Google trusts the listing, whether what is here
 * matches what is there, and when anything last went out. Each tile's
 * action is the one fix for its problem. Everything is read from the
 * DB-only summary; nothing here asks Google.
 */
function HealthStrip({
  locationId,
  linked,
  clientId,
  summary,
  summaryFailed = false,
  canManageConsoles,
}: {
  locationId: string
  linked: boolean
  clientId: string | null
  summary: ListingSummary | undefined
  /** The summary request failed: say so instead of guessing. */
  summaryFailed?: boolean
  canManageConsoles: boolean
}) {
  if (!summary && summaryFailed) {
    return (
      <div className={GRID}>
        {[
          ["connection", "Google connection"],
          ["verification", "Verification"],
          ["sync", "Sync with Google"],
          ["published", "Last published"],
        ].map(([id, label]) => (
          <Tile
            key={id}
            id={id!}
            label={label!}
            value={
              <StatusPill tone="neutral" plain>
                Couldn’t check
              </StatusPill>
            }
            detail="The listing summary didn’t load. Opening an area reads it directly."
          />
        ))}
      </div>
    )
  }

  if (!summary) {
    return (
      <div aria-busy="true" className={GRID}>
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="flex flex-col gap-2.5 rounded-(--np-radius-card) border border-line bg-surface p-4"
          >
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-[22px] w-2/5" />
            <Skeleton className="h-3.5 w-4/5" />
          </div>
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
  const accessLost = summary.freshness?.reason === "listing_access_lost"
  const unpublished = unpublishedCount(summary)
  const changed = googleChangedCount(summary)
  const last = summary.lastPublish
  const unchecked = uncheckedAreas(summary)

  return (
    <div className={GRID}>
      <Tile
        id="connection"
        label="Google connection"
        value={
          !linked ? (
            <StatusPill tone="neutral">Not linked</StatusPill>
          ) : connectionBroken ? (
            <StatusPill tone="at-risk">Needs reconnecting</StatusPill>
          ) : accessLost ? (
            <StatusPill tone="at-risk">Access lost</StatusPill>
          ) : summary.freshness?.state === "data_delayed" ? (
            <StatusPill tone="attention">Data delayed</StatusPill>
          ) : (
            <StatusPill tone="healthy">Up to date</StatusPill>
          )
        }
        detail={
          accessLost && !connectionBroken
            ? "The login no longer manages this listing. Ask the business to add it back as a manager."
            : [
                connection?.googleEmail ??
                  (linked
                    ? "No Google login on record"
                    : "Link it from the client’s setup"),
                linked && summary.freshness
                  ? summary.freshness.lastCheckedAt
                    ? `reviews checked ${formatRelativeTime(summary.freshness.lastCheckedAt)}`
                    : "reviews not checked yet"
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")
        }
        action={
          linked && connectionBroken && clientId && canManageConsoles ? (
            <Link
              href={`/setup?client=${clientId}&step=connect`}
              className={ACTION}
            >
              Reconnect Google
            </Link>
          ) : undefined
        }
      />
      <Tile
        id="verification"
        label="Verification"
        value={
          !linked ? (
            <StatusPill tone="neutral" plain>
              Not linked
            </StatusPill>
          ) : summary.verified ? (
            <StatusPill tone="healthy">Verified</StatusPill>
          ) : (
            <StatusPill tone="attention">Not verified</StatusPill>
          )
        }
        detail={
          summary.verified
            ? "Google trusts this listing"
            : "Some changes won’t show until Google verifies it"
        }
        action={
          linked && !summary.verified && canManageConsoles ? (
            <Link
              href={listingHref(locationId, "verification")}
              className={ACTION}
            >
              Verify
            </Link>
          ) : undefined
        }
      />
      <Tile
        id="sync"
        label="Sync with Google"
        value={
          unpublished === 0 && changed === 0 ? (
            unchecked.length > 0 ? (
              <StatusPill tone="neutral">Nothing waiting</StatusPill>
            ) : (
              <StatusPill tone="healthy">In sync</StatusPill>
            )
          ) : (
            <>
              {unpublished > 0 ? (
                <StatusPill tone="pending">
                  {formatNumber(unpublished)} to publish
                </StatusPill>
              ) : null}
              {changed > 0 ? (
                <StatusPill tone="attention">
                  {changed === 1
                    ? "1 Google change"
                    : `${formatNumber(changed)} Google changes`}
                </StatusPill>
              ) : null}
            </>
          )
        }
        detail={
          unpublished > 0
            ? "Saved here, not yet on Google"
            : changed > 0
              ? "Google changed something since the last publish"
              : unchecked.length > 0
                ? `Not compared with Google yet: ${unchecked.join(", ")}`
                : "What is here matches what customers see"
        }
        action={
          unpublished > 0 ? (
            <Link href={listingHref(locationId, "changes")} className={ACTION}>
              Review &amp; publish
            </Link>
          ) : changed > 0 ? (
            <Link
              href={listingHref(locationId, "suggestions")}
              className={ACTION}
            >
              Review
            </Link>
          ) : undefined
        }
      />
      <Tile
        id="published"
        label="Last published"
        value={
          last ? (
            <>
              <span className="font-mono text-[17px] leading-6 font-semibold text-ink tabular-nums">
                {capitalise(formatRelativeTime(last.at))}
              </span>
              {last.status === "failed" ? (
                <StatusPill tone="at-risk">Failed</StatusPill>
              ) : last.status === "ambiguous" ? (
                <StatusPill tone="attention">Outcome unclear</StatusPill>
              ) : last.status === "in_progress" ? (
                <StatusPill tone="pending">In progress</StatusPill>
              ) : null}
            </>
          ) : (
            <span className="font-mono text-[17px] leading-6 font-semibold text-ink-muted">
              Never
            </span>
          )
        }
        detail={
          last
            ? last.status === "failed"
              ? `The last ${last.area} publish failed`
              : last.status === "in_progress"
                ? `A ${last.area} publish is in progress`
                : last.status === "ambiguous"
                  ? `Google didn’t confirm the last ${last.area} publish`
                  : `Last change: ${last.area}`
            : "Nothing has been published from here yet"
        }
      />
    </div>
  )
}

export { HealthStrip }
