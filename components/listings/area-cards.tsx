"use client"

import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import type {
  ListingSummary,
  SyncedArea,
} from "@/lib/contracts/location-summary"
import { formatNumber, formatRelativeTime } from "@/lib/format"
import { syncStatusLabel, syncStatusTone } from "@/lib/listings/health"
import {
  listingHref,
  visibleListingAreas,
  type ListingArea,
} from "@/lib/listings/areas"
import {
  resourceDisabledReason,
  type LocationCapabilities,
} from "@/lib/locations/gating"
import type { StatusTone } from "@/lib/ui/status-tone"

type CardState = {
  tone: StatusTone
  label: string
  /** One line of substance under the description. */
  line: string | null
}

function syncedState(area: SyncedArea, checkedNote = true): CardState {
  const line =
    area.status === "core_dirty" || area.status === "conflict"
      ? area.dirtyCount > 1
        ? `${area.dirtyCount} fields not yet on Google`
        : "Edited here, not yet on Google"
      : area.observedAt && checkedNote
        ? `Checked against Google ${formatRelativeTime(area.observedAt)}`
        : null
  return {
    tone: syncStatusTone(area.status),
    label: syncStatusLabel(area.status),
    line,
  }
}

function stateFor(area: ListingArea, summary: ListingSummary): CardState {
  switch (area.key) {
    case "profile":
      return syncedState(summary.profile)
    case "hours":
      return syncedState(summary.hours)
    case "menu":
      if (summary.menu.eligible === false)
        return {
          tone: "neutral",
          label: "Not offered",
          line: "Google does not show a menu for this kind of business",
        }
      return syncedState(summary.menu)
    case "booking":
      return {
        tone: "neutral",
        label: "Live on Google",
        line:
          summary.booking.count === 0
            ? "No booking links yet"
            : summary.booking.count === 1
              ? "1 link on the listing"
              : `${formatNumber(summary.booking.count)} links on the listing`,
      }
    case "photos":
      return {
        tone: "neutral",
        label: "Live on Google",
        line:
          summary.photos.count === 0
            ? "No photos of yours yet"
            : `${formatNumber(summary.photos.count)} of your photos`,
      }
    case "posts": {
      const { drafts, awaitingApproval, failed, published } = summary.posts
      if (failed > 0)
        return {
          tone: "at-risk",
          label: "Publish failed",
          line:
            failed === 1
              ? "1 post failed to publish"
              : `${failed} posts failed to publish`,
        }
      if (awaitingApproval > 0)
        return {
          tone: "pending",
          label: "Awaiting approval",
          line:
            awaitingApproval === 1
              ? "1 post awaiting approval"
              : `${awaitingApproval} posts awaiting approval`,
        }
      if (drafts > 0)
        return {
          tone: "pending",
          label: "Drafts",
          line:
            drafts === 1
              ? "1 draft not yet published"
              : `${drafts} drafts not yet published`,
        }
      return {
        tone: "neutral",
        label: "Live on Google",
        line:
          published === 0
            ? "No posts yet"
            : `${formatNumber(published)} published`,
      }
    }
    case "people":
      return {
        tone: "neutral",
        label: "Live on Google",
        line: "Owners, managers and invitations on Google",
      }
    case "verification":
      return summary.verified
        ? {
            tone: "healthy",
            label: "Verified",
            line: "Google trusts this listing",
          }
        : {
            tone: "pending",
            label: "Not verified",
            line: "Start or complete a verification",
          }
    case "suggestions": {
      const count = summary.suggestions.profile + summary.suggestions.foodMenus
      return {
        tone: count > 0 ? "attention" : "healthy",
        label: count > 0 ? "Waiting for a decision" : "Nothing waiting",
        line:
          count > 0
            ? count === 1
              ? "1 change Google made"
              : `${count} changes Google made`
            : null,
      }
    }
  }
}

function AreaCardSkeleton() {
  return <Skeleton className="h-36 rounded-(--np-radius-card)" />
}

/**
 * One card per area of the listing: what it is, where it stands, and the
 * way in. The status comes from the DB-only summary, so the grid answers
 * "which of these needs me" without loading a single editor. An area whose
 * capability is blocked or unavailable says why instead of offering Edit.
 */
function AreaCards({
  locationId,
  linked,
  summary,
  caps,
  canManageConsoles,
}: {
  locationId: string
  linked: boolean
  summary: ListingSummary | undefined
  caps: LocationCapabilities | undefined
  canManageConsoles: boolean
}) {
  const areas = visibleListingAreas(canManageConsoles).filter((area) =>
    area.key === "suggestions"
      ? Boolean(
          summary &&
          summary.suggestions.profile + summary.suggestions.foodMenus > 0
        )
      : true
  )

  return (
    <div className="grid gap-(--np-gap-card) sm:grid-cols-2 xl:grid-cols-3">
      {areas.map((area) => {
        if (!summary) return <AreaCardSkeleton key={area.key} />
        const state = stateFor(area, summary)
        const blocked = !linked
          ? "Link this listing to Google to manage it here."
          : area.capability
            ? resourceDisabledReason(caps, area.capability, true)
            : null
        const readOnly =
          blocked &&
          caps?.resources?.[area.capability ?? ""]?.state === "readOnly"
        return (
          <Card
            key={area.key}
            size="sm"
            data-slot="area-card"
            data-area={area.key}
          >
            <CardHeader>
              <CardTitle as="h3">{area.label}</CardTitle>
              <CardDescription>{area.description}</CardDescription>
              <CardAction>
                <StatusPill
                  tone={blocked && !readOnly ? "neutral" : state.tone}
                >
                  {blocked && !readOnly ? "Unavailable" : state.label}
                </StatusPill>
              </CardAction>
            </CardHeader>
            <CardContent className="flex items-end justify-between gap-3">
              <p className="min-w-0 text-caption text-ink-muted">
                {blocked && !readOnly ? blocked : (state.line ?? " ")}
              </p>
              {!blocked || readOnly ? (
                <Link
                  href={listingHref(locationId, area.segment)}
                  className={buttonVariants({
                    variant: "secondary",
                    size: "sm",
                    pill: true,
                  })}
                  aria-label={`${readOnly ? "View" : "Open"} ${area.label}`}
                >
                  {readOnly ? "View" : "Open"}
                </Link>
              ) : null}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

export { AreaCards }
