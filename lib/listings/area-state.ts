/**
 * Where one area of a listing stands, in words and a tone, from the DB-only
 * summary. One function, so the overview's area card, the area header's
 * status pill and the area tab's badge can never tell three different
 * stories about the same area. Pure and client-safe.
 */
import type {
  ListingSummary,
  SyncedArea,
} from "@/lib/contracts/location-summary"
import { formatNumber, formatRelativeTime } from "@/lib/format"
import type { ListingArea, ListingAreaKey } from "@/lib/listings/areas"
import {
  googleUnreachable,
  syncStatusLabel,
  syncStatusTone,
  UNREACHABLE_LABEL,
} from "@/lib/listings/health"
import type { StatusTone } from "@/lib/ui/status-tone"

export type AreaState = {
  tone: StatusTone
  /** The pill's word: "Not on Google yet", "Awaiting approval", … */
  label: string
  /** One line of substance, or null when there is nothing to add. */
  line: string | null
}

/** Pending suggested updates across both inbound resources. */
export function suggestionCount(summary: ListingSummary | undefined): number {
  if (!summary) return 0
  return summary.suggestions.profile + summary.suggestions.foodMenus
}

/**
 * Canonical areas never compared with Google ("unknown"), by name. While any
 * remain, "matches what customers see" is a claim nothing backs.
 */
export function uncheckedAreas(summary: ListingSummary): string[] {
  return [
    { name: "business profile", area: summary.profile },
    { name: "opening hours", area: summary.hours },
    ...(summary.menu.eligible === false
      ? []
      : [{ name: "food menu", area: summary.menu }]),
  ]
    .filter(({ area }) => area.status === "unknown")
    .map(({ name }) => name)
}

/** "Just now" / "2 h ago" / "5 Sep", readable mid-sentence. */
function when(iso: string): string {
  const text = formatRelativeTime(iso)
  return text === "Just now" ? "just now" : text
}

function syncedState(area: SyncedArea, unreachable = false): AreaState {
  const dirty = area.status === "core_dirty" || area.status === "conflict"
  // With Google out of reach, only what is known locally can be said: edits
  // saved here are still not on Google, but "in sync", "changed on Google"
  // and "checked just now" are as old as the break.
  if (unreachable && !dirty)
    return {
      tone: "neutral",
      label: UNREACHABLE_LABEL,
      line: area.observedAt
        ? `Last compared with Google ${when(area.observedAt)}`
        : "Not compared with Google yet",
    }
  const line = dirty
    ? area.dirtyCount > 1
      ? `${formatNumber(area.dirtyCount)} fields not yet on Google`
      : "Edited here, not yet on Google"
    : area.status === "google_dirty"
      ? area.observedAt
        ? `Changed on Google · checked ${when(area.observedAt)}`
        : "Changed on Google"
      : area.observedAt
        ? `Checked against Google ${when(area.observedAt)}`
        : area.status === "unknown"
          ? "Not compared with Google yet"
          : null
  return {
    tone: syncStatusTone(area.status),
    label:
      dirty && area.dirtyCount > 1
        ? `${formatNumber(area.dirtyCount)} changes not on Google`
        : area.status === "in_sync"
          ? "In sync"
          : syncStatusLabel(area.status),
    line,
  }
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many.replace("#", formatNumber(count))
}

export function areaState(
  key: ListingAreaKey,
  summary: ListingSummary
): AreaState {
  switch (key) {
    case "profile":
      return syncedState(summary.profile, googleUnreachable(summary))
    case "hours":
      return syncedState(summary.hours, googleUnreachable(summary))
    case "menu":
      if (summary.menu.eligible === false)
        return {
          tone: "neutral",
          label: "Not offered",
          line: "Google does not show a menu for this kind of business",
        }
      return syncedState(summary.menu, googleUnreachable(summary))
    case "booking":
      return {
        tone: "neutral",
        label: "On Google",
        line:
          summary.booking.count === 0
            ? "No booking links yet"
            : plural(
                summary.booking.count,
                "1 link on the listing",
                "# links on the listing"
              ),
      }
    case "photos":
      return {
        tone: "neutral",
        label: "On Google",
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
          line: plural(
            failed,
            "1 post failed to publish",
            "# posts failed to publish"
          ),
        }
      if (awaitingApproval > 0)
        return {
          tone: "attention",
          label: "Awaiting approval",
          line: plural(
            awaitingApproval,
            "1 post awaiting approval",
            "# posts awaiting approval"
          ),
        }
      if (drafts > 0)
        return {
          tone: "pending",
          label: "Drafts",
          line: plural(
            drafts,
            "1 draft not yet published",
            "# drafts not yet published"
          ),
        }
      return {
        tone: "neutral",
        label: "Nothing waiting",
        line:
          published === 0
            ? "No posts yet"
            : `${formatNumber(published)} published`,
      }
    }
    case "people":
      return {
        tone: "neutral",
        label: "On Google",
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
            tone: "attention",
            label: "Not verified",
            line: "Start or complete a verification",
          }
    case "suggestions": {
      const count = suggestionCount(summary)
      return {
        tone: count > 0 ? "attention" : "healthy",
        label: count > 0 ? `${formatNumber(count)} waiting` : "Nothing waiting",
        line:
          count > 0
            ? plural(
                count,
                "1 change Google made to this listing",
                "# changes Google made to this listing"
              )
            : null,
      }
    }
  }
}

/** Convenience for callers that hold the registry entry. */
export function areaStateFor(
  area: ListingArea,
  summary: ListingSummary
): AreaState {
  return areaState(area.key, summary)
}
