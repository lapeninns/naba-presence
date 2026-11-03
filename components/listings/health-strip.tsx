"use client"

import { Fragment } from "react"

import { RelativeTime } from "@/components/ui/relative-time"
import { SettingsGroup, SettingsRow } from "@/components/ui/settings-row"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import type {
  LastPublish,
  ListingSummary,
} from "@/lib/contracts/location-summary"
import type { PresentedState } from "@/lib/editors/outcome"
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

/** "Last sent", not "last published": a send is not proof Google shows it. */
const LAST_SENT_LABEL = "Last sent to Google"

const LAST_SENT_STATE = {
  failed: "failed",
  ambiguous: "uncertain",
  in_progress: "sent",
} as const satisfies Record<
  Exclude<LastPublish["status"], "succeeded">,
  PresentedState
>

/** The last send in words, shared by the overview's alert and its row. */
function lastSentDescription(
  status: LastPublish["status"],
  area: string
): string {
  switch (status) {
    case "failed":
      return `The last ${area} change didn’t go through`
    case "ambiguous":
      return `Google hasn’t confirmed the last ${area} change`
    case "in_progress":
      return `A ${area} change is being sent to Google`
    case "succeeded":
      return `Last change: ${area}`
  }
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
        {["Google connection", LAST_SENT_LABEL].map((label) => (
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
        label={LAST_SENT_LABEL}
        value={
          last ? (
            <>
              <RelativeTime iso={last.at} casing="sentence" />
              {/* A state, in the lifecycle words; a send that went through
                  carries none, since the summary can't say Google shows it. */}
              {last.status === "succeeded" ? null : (
                <StatusPill
                  state={LAST_SENT_STATE[last.status]}
                  className="ms-2"
                />
              )}
            </>
          ) : (
            "Never"
          )
        }
        description={
          last
            ? lastSentDescription(last.status, publishAreaName(last.area))
            : "Nothing has been sent to Google from here yet"
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

export { HealthStrip, lastSentDescription, publishAreaName }
