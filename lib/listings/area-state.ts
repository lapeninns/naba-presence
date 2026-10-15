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
import { formatNumber } from "@/lib/format"
import type { ListingArea, ListingAreaKey } from "@/lib/listings/areas"
import {
  googleUnreachable,
  comparisonCheck,
  noHoursOnGoogle,
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
  /**
   * When the line ends with how long ago something happened ("Checked
   * against Google 4 minutes ago"), the instant, said as a relative time
   * after `line` by the component that renders it: a gap computed here,
   * during render, would differ between the server and the browser.
   */
  since?: string
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
export function uncheckedAreas(
  summary: ListingSummary,
  now?: number
): string[] {
  return [
    { name: "business profile", area: summary.profile },
    { name: "opening hours", area: summary.hours },
    ...(summary.menu.eligible === false
      ? []
      : [{ name: "food menu", area: summary.menu }]),
  ]
    .filter(({ area }) => comparisonCheck(area, now) !== "checked")
    .map(({ name }) => name)
}

function syncedState(
  area: SyncedArea,
  unreachable = false,
  now?: number
): AreaState {
  const dirty = area.status === "core_dirty" || area.status === "conflict"
  // With Google out of reach, only what is known locally can be said: edits
  // saved here are still not on Google, but "in sync", "changed on Google"
  // and "checked just now" are as old as the break.
  if (unreachable && !dirty)
    return {
      tone: "neutral",
      label: UNREACHABLE_LABEL,
      ...(area.observedAt
        ? { line: "Last compared with Google", since: area.observedAt }
        : { line: "Not compared with Google yet" }),
    }
  const check = comparisonCheck(area, now)
  if (!dirty && check !== "checked")
    return {
      tone: check === "failed" ? "attention" : "neutral",
      label:
        check === "failed"
          ? "Couldn’t check"
          : check === "stale"
            ? "Check overdue"
            : "Not checked yet",
      ...(area.observedAt
        ? { line: "Last compared with Google", since: area.observedAt }
        : { line: "Not compared with Google yet" }),
    }
  const since = !dirty && area.observedAt ? area.observedAt : undefined
  const line = dirty
    ? area.dirtyCount > 1
      ? `${formatNumber(area.dirtyCount)} fields not yet on Google`
      : "Edited here, not yet on Google"
    : area.status === "google_dirty"
      ? since
        ? "Changed on Google · checked"
        : "Changed on Google"
      : since
        ? "Checked against Google"
        : area.status === "unknown"
          ? "Not compared with Google yet"
          : null
  return {
    tone: syncStatusTone(area.status),
    label:
      dirty && area.dirtyCount > 1
        ? `${formatNumber(area.dirtyCount)} changes not on Google`
        : syncStatusLabel(area.status),
    line,
    ...(since ? { since } : {}),
  }
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many.replace("#", formatNumber(count))
}

/**
 * `now` decides whether a comparison is overdue (an hour old). Pass `useNow()`
 * from a component so the server and the hydrating browser agree.
 */
export function areaState(
  key: ListingAreaKey,
  summary: ListingSummary,
  now?: number
): AreaState {
  switch (key) {
    case "profile":
      return syncedState(summary.profile, googleUnreachable(summary), now)
    case "hours": {
      const unreachable = googleUnreachable(summary)
      const hours = summary.hours
      // Google's empty hours are an in-sync state, but not a fine one: the
      // words match the hours editor ("No hours on Google"). Local edits,
      // a conflict, a change made on Google (hours removed there: "Changed
      // on Google" asks for the review) and an unreachable Google keep their
      // own words.
      if (
        !unreachable &&
        hours.status === "in_sync" &&
        noHoursOnGoogle(summary, now)
      )
        return {
          tone: "attention",
          label: "No hours on Google",
          line: "Customers see no opening hours",
        }
      return syncedState(hours, unreachable, now)
    }
    case "menu":
      if (summary.menu.eligible === false)
        return {
          tone: "neutral",
          label: "Not offered",
          line: "Google does not show a menu for this kind of business",
        }
      return syncedState(summary.menu, googleUnreachable(summary), now)
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
      if (summary.lifecycleEnded)
        return {
          tone: "attention",
          label:
            summary.lifecycleEnded === "delete_location"
              ? "Deleted from Google"
              : "Moved to another account",
          line: "This account no longer manages the listing on Google",
        }
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
  summary: ListingSummary,
  now?: number
): AreaState {
  return areaState(area.key, summary, now)
}
