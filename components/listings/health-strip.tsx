"use client"

import { Fragment } from "react"

import { ShellLink } from "@/components/app-shell/shell-link"
import { buttonVariants } from "@/components/ui/button"
import { RelativeTime } from "@/components/ui/relative-time"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import type { ListingSummary } from "@/lib/contracts/location-summary"
import { formatNumber } from "@/lib/format"
import { uncheckedAreas } from "@/lib/listings/area-state"
import {
  googleChangedCount,
  listingHealth,
  listingHealthLabel,
  listingHealthTone,
  UNREACHABLE_LABEL,
  unpublishedCount,
} from "@/lib/listings/health"
import { listingHref } from "@/lib/listings/areas"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"
import { cardClassName } from "@/components/ui/card"
import { useNow } from "@/lib/time/server-now"

/**
 * The strip answers to its own width (`@container/health`): under 36rem (a
 * phone) each fact is a row, the question then its answer pill on one line;
 * from 36rem a grid of tiles, two across, four from 56rem.
 */
const GRID =
  "grid gap-2 @xl/health:grid-cols-2 @xl/health:gap-3 @4xl/health:grid-cols-4"

/** The strip's own size container, around every state of the grid. */
function StripFrame({ children }: { children: React.ReactNode }) {
  return <div className="@container/health">{children}</div>
}

/**
 * One fact as a tile (reference `.stat.tile`): the question in muted UI
 * text, the answer as status words, one line of detail, and — when there is
 * one — the single fix, at the tile's foot. On a phone the same tile is a
 * row: "Question ······ [answer]", the detail and the fix under it.
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
      className={cardClassName({
        className:
          "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 p-3 @xl/health:flex-col @xl/health:flex-nowrap @xl/health:items-stretch @xl/health:gap-2 @xl/health:p-4",
      })}
    >
      <p className="min-w-0 grow text-ui font-medium text-ink-muted @xl/health:grow-0">
        {label}
      </p>
      <div className="flex min-h-6.5 flex-wrap items-center justify-end gap-1.5 @xl/health:justify-start">
        {value}
      </div>
      <p className="basis-full text-caption break-words text-ink-muted @xl/health:basis-auto">
        {detail}
      </p>
      {action ? (
        <div className="basis-full pt-1 @xl/health:mt-auto @xl/health:basis-auto">
          {action}
        </div>
      ) : null}
    </div>
  )
}

const ACTION = cn(
  buttonVariants({ variant: "secondary", size: "sm" }),
  "h-auto min-h-8 max-w-full py-1.5 text-center whitespace-normal"
)

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
  const now = useNow()
  const business = useWorkspaceMode() === "business"
  if (!summary && summaryFailed) {
    return (
      <StripFrame>
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
      </StripFrame>
    )
  }

  if (!summary) {
    return (
      <StripFrame>
        <div aria-busy="true" className={GRID}>
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className={cardClassName({
                className:
                  "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 p-3 @xl/health:flex-col @xl/health:flex-nowrap @xl/health:items-stretch @xl/health:gap-2.5 @xl/health:p-4",
              })}
            >
              <Skeleton className="h-3.5 w-1/3 @xl/health:w-1/2" />
              <Skeleton className="h-5.5 w-24 @xl/health:w-2/5" />
              <Skeleton className="h-3.5 basis-full @xl/health:w-4/5 @xl/health:basis-auto" />
            </div>
          ))}
        </div>
      </StripFrame>
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
  const unchecked = uncheckedAreas(summary, now)
  const health = listingHealth({ linked, summary, now })
  // Without a working login for this listing nothing here was checked
  // recently, whatever the last comparison said.
  const unreachable = linked && (connectionBroken || accessLost)

  return (
    <StripFrame>
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
                      : business
                        ? "Link it from setup"
                        : "Link it from the client’s setup"),
                  linked && summary.freshness ? (
                    summary.freshness.lastCheckedAt ? (
                      <RelativeTime
                        iso={summary.freshness.lastCheckedAt}
                        prefix="reviews checked "
                      />
                    ) : (
                      "reviews not checked yet"
                    )
                  ) : null,
                ]
                  .filter(Boolean)
                  .map((part, index) => (
                    <Fragment key={index}>
                      {index > 0 ? " · " : null}
                      {part}
                    </Fragment>
                  ))
          }
          action={
            linked && connectionBroken && clientId && canManageConsoles ? (
              <ShellLink
                href={`/setup?client=${clientId}&step=connect`}
                className={ACTION}
              >
                Reconnect Google
              </ShellLink>
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
              <ShellLink
                href={listingHref(locationId, "verification")}
                className={ACTION}
              >
                Verify
              </ShellLink>
            ) : undefined
          }
        />
        <Tile
          id="sync"
          label="Sync with Google"
          value={
            unpublished === 0 && changed === 0 ? (
              unreachable ? (
                <StatusPill tone="neutral">{UNREACHABLE_LABEL}</StatusPill>
              ) : health !== "healthy" ? (
                <StatusPill tone={listingHealthTone(health)}>
                  {listingHealthLabel(health)}
                </StatusPill>
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
            unreachable
              ? unpublished > 0
                ? "Saved here, not yet on Google. Google can’t be checked until the connection is fixed."
                : "Google can’t be checked until the connection is fixed, so this may be out of date."
              : unpublished > 0
                ? "Saved here, not yet on Google"
                : changed > 0
                  ? "Google differs from the saved listing"
                  : unchecked.length > 0
                    ? `Current comparison needed: ${unchecked.join(", ")}`
                    : "Applicable areas matched Google at their latest checks"
          }
          action={
            unpublished > 0 ? (
              <ShellLink
                href={listingHref(locationId, "changes")}
                className={ACTION}
              >
                Review &amp; publish
              </ShellLink>
            ) : changed > 0 ? (
              <ShellLink
                href={listingHref(locationId, "suggestions")}
                className={ACTION}
              >
                Review
              </ShellLink>
            ) : undefined
          }
        />
        <Tile
          id="published"
          label="Last published"
          value={
            last ? (
              <>
                <span className="text-title font-semibold text-ink tabular-nums">
                  <RelativeTime iso={last.at} casing="sentence" />
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
              <span className="text-title font-semibold text-ink-muted">
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
    </StripFrame>
  )
}

export { HealthStrip }
