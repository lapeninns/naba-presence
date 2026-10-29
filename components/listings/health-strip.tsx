"use client"

import { Fragment } from "react"

import { RelativeTime } from "@/components/ui/relative-time"
import { SettingsGroup, SettingsRow } from "@/components/ui/settings-row"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import type { ListingSummary } from "@/lib/contracts/location-summary"
import { areaForSegment } from "@/lib/listings/areas"
import { useWorkspaceMode } from "@/lib/workspace/mode"

/**
 * The area a publish went to, in the words its card uses ("opening hours",
 * "food menu"), not the summary's own key. A key no area owns ("listing")
 * stays as it is.
 */
function publishAreaName(area: string): string {
  return areaForSegment(area)?.label.toLowerCase() ?? area
}

/**
 * The listing's two facts the area cards cannot carry: whether Google is
 * reachable, and when anything last went out. Verification and sync are
 * already each area card's own status (and the header pill), so they are
 * not repeated here, except for a reader who has no Verification card and
 * no alert (see `showVerification`). A broken or missing link to Google is
 * the overview's first alert, with its fix, so it is only stated here.
 * Everything is read from the DB-only summary; nothing here asks Google.
 */
function HealthStrip({
  linked,
  summary,
  summaryFailed = false,
  disconnected = false,
  canManageConsoles,
}: {
  linked: boolean
  summary: ListingSummary | undefined
  /** The summary request failed: say so instead of guessing. */
  summaryFailed?: boolean
  /** The connection is broken, so the rest is as of the last sync. */
  disconnected?: boolean
  canManageConsoles: boolean
}) {
  const business = useWorkspaceMode() === "business"
  const group = (children: React.ReactNode, busy = false) => (
    <SettingsGroup
      id="listing-health"
      label="Google"
      caption={
        disconnected
          ? "The connection is broken, so the rest is as of the last sync."
          : "The connection to Google and what last went out."
      }
      card
      className="mt-0"
      aria-busy={busy || undefined}
    >
      {children}
    </SettingsGroup>
  )

  if (!summary && summaryFailed) {
    return group(
      <>
        {["Google connection", "Last published"].map((label) => (
          <SettingsRow
            key={label}
            label={label}
            description="The listing summary didn’t load. Opening an area reads it directly."
            value={
              <StatusPill tone="neutral" plain>
                Couldn’t check
              </StatusPill>
            }
          />
        ))}
      </>
    )
  }

  if (!summary) {
    return group(
      <>
        {[0, 1].map((index) => (
          <li key={index} aria-hidden className="py-3">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="mt-2 h-3.5 w-3/4" />
          </li>
        ))}
      </>,
      true
    )
  }

  const connection = summary.connection
  const connectionBroken =
    !linked ||
    !connection ||
    connection.status !== "active" ||
    connection.reconnectRequired
  const accessLost = summary.freshness?.reason === "listing_access_lost"
  const last = summary.lastPublish
  // The Verification area card is for owners and admins, and the overview's
  // "Google hasn't verified" alert is hidden while the connection is broken.
  // Anyone left without either still gets to read the state, here.
  const alertHidden = Boolean(
    connection &&
    (connection.status !== "active" || connection.reconnectRequired)
  )
  const showVerification =
    linked && !summary.verified && !canManageConsoles && alertHidden

  return group(
    <>
      <SettingsRow
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
        description={
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
      />
      <SettingsRow
        label="Last published"
        value={
          last ? (
            <>
              <RelativeTime iso={last.at} casing="sentence" />
              {last.status === "failed" ? (
                <StatusPill tone="at-risk" className="ms-2">
                  Failed
                </StatusPill>
              ) : last.status === "ambiguous" ? (
                <StatusPill tone="attention" className="ms-2">
                  Outcome unclear
                </StatusPill>
              ) : last.status === "in_progress" ? (
                <StatusPill tone="pending" className="ms-2">
                  In progress
                </StatusPill>
              ) : null}
            </>
          ) : (
            "Never"
          )
        }
        description={
          last
            ? last.status === "failed"
              ? `The last ${publishAreaName(last.area)} publish failed`
              : last.status === "in_progress"
                ? `A ${publishAreaName(last.area)} publish is in progress`
                : last.status === "ambiguous"
                  ? `Google didn’t confirm the last ${publishAreaName(last.area)} publish`
                  : `Last change: ${publishAreaName(last.area)}`
            : "Nothing has been published from here yet"
        }
      />
      {showVerification ? (
        <SettingsRow
          label="Verification"
          value={<StatusPill tone="attention">Not verified</StatusPill>}
          description="Some changes won’t show until Google verifies it"
        />
      ) : null}
    </>
  )
}

export { HealthStrip, publishAreaName }
