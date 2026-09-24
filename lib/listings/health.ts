/**
 * Listing health: one word for "what state is this Google listing in".
 *
 * Derived, never stored, from the directory entry and the DB-only summary.
 * Mirrors `lib/clients/health.ts` so the board, the overview header and the
 * client hub rows all say the same thing about the same listing. Pure and
 * client-safe.
 */
import type {
  ListingSummary,
  SyncStatus,
} from "@/lib/contracts/location-summary"
import type { StatusTone } from "@/lib/ui/status-tone"

export const LISTING_HEALTH = [
  "not_linked",
  "disconnected",
  "access_lost",
  "pending_verification",
  "attention",
  "unpublished",
  "healthy",
] as const
export type ListingHealth = (typeof LISTING_HEALTH)[number]

export type ListingHealthInput = {
  linked: boolean
  verified?: boolean | null
  summary?: ListingSummary | null
}

const DIRTY: readonly SyncStatus[] = ["core_dirty", "conflict"]
const GOOGLE_CHANGED: readonly SyncStatus[] = ["google_dirty", "conflict"]

/** Local edits not on Google, counted across the canonical areas. */
export function unpublishedCount(summary: ListingSummary): number {
  return [summary.profile, summary.hours, summary.menu].reduce(
    (sum, area) =>
      sum + (DIRTY.includes(area.status) ? Math.max(area.dirtyCount, 1) : 0),
    0
  )
}

/** Areas Google changed since we last published, plus pending suggestions. */
export function googleChangedCount(summary: ListingSummary): number {
  const areas = [summary.profile, summary.hours, summary.menu].filter((area) =>
    GOOGLE_CHANGED.includes(area.status)
  ).length
  return areas + summary.suggestions.profile + summary.suggestions.foodMenus
}

export function hasConflict(summary: ListingSummary): boolean {
  return [summary.profile, summary.hours, summary.menu].some(
    (area) => area.status === "conflict"
  )
}

/**
 * Google can't be read for this listing right now: its login is expired,
 * revoked or failing, or the login no longer manages the listing. While
 * that holds, nothing may claim "In sync" or "checked just now"; the last
 * comparison is as old as the break.
 */
export function googleUnreachable(
  summary: ListingSummary | null | undefined
): boolean {
  if (!summary) return false
  const connection = summary.connection
  if (
    connection &&
    (connection.status !== "active" || connection.reconnectRequired)
  )
    return true
  return summary.freshness?.reason === "listing_access_lost"
}

/** The words for a sync state nobody can check right now. */
export const UNREACHABLE_LABEL = "Unknown — can’t reach Google"

/**
 * Worst-first, like client health. A listing is `healthy` only when nothing
 * else applies. `unpublished` sits below `attention`: work waiting to go out
 * is a to-do, a failed publish or a conflict is a problem.
 */
export function listingHealth(input: ListingHealthInput): ListingHealth {
  if (!input.linked) return "not_linked"
  const summary = input.summary
  const connection = summary?.connection
  if (
    connection &&
    (connection.status !== "active" || connection.reconnectRequired)
  ) {
    return "disconnected"
  }
  // The login works, but not for this listing: a person at the business has
  // to restore manager access; a reconnect would change nothing.
  if (summary?.freshness?.reason === "listing_access_lost") return "access_lost"
  if (input.verified === false || summary?.verified === false) {
    return "pending_verification"
  }
  if (!summary) return "healthy"
  if (
    summary.lastPublish?.status === "failed" ||
    summary.posts.failed > 0 ||
    hasConflict(summary) ||
    googleChangedCount(summary) > 0
  ) {
    return "attention"
  }
  if (unpublishedCount(summary) > 0 || summary.posts.awaitingApproval > 0) {
    return "unpublished"
  }
  return "healthy"
}

const TONES: Record<ListingHealth, StatusTone> = {
  healthy: "healthy",
  unpublished: "pending",
  attention: "attention",
  pending_verification: "pending",
  disconnected: "at-risk",
  access_lost: "at-risk",
  not_linked: "neutral",
}

export function listingHealthTone(health: ListingHealth): StatusTone {
  return TONES[health]
}

const LABELS: Record<ListingHealth, string> = {
  healthy: "In sync",
  unpublished: "Changes to publish",
  attention: "Needs attention",
  pending_verification: "Pending verification",
  disconnected: "Disconnected",
  access_lost: "Access lost",
  not_linked: "Not linked",
}

export function listingHealthLabel(health: ListingHealth): string {
  return LABELS[health]
}

/** One sentence: what is wrong and what to do. Never a provider code. */
export function listingHealthDescription(health: ListingHealth): string {
  switch (health) {
    case "healthy":
      return "Everything here matches what customers see on Google."
    case "unpublished":
      return "Edits are saved here but not yet on Google. Review and publish them."
    case "attention":
      return "Something needs a decision: a failed publish, a conflict, or a change Google made."
    case "pending_verification":
      return "Google has not verified this listing yet, so some changes will not show."
    case "disconnected":
      return "The Google login behind this listing needs reconnecting."
    case "access_lost":
      return "The Google login no longer manages this listing. Ask the business to add it back as a manager; reconnecting won't help."
    case "not_linked":
      return "Link this listing to Google Business Profile to manage it here."
  }
}

/** The status vocabulary an area card shows for a synced area. */
export function syncStatusLabel(status: SyncStatus): string {
  switch (status) {
    case "in_sync":
      return "In sync with Google"
    case "core_dirty":
      return "Not on Google yet"
    case "google_dirty":
      return "Changed on Google"
    case "conflict":
      return "Conflict"
    case "unknown":
      return "Not checked yet"
  }
}

export function syncStatusTone(status: SyncStatus): StatusTone {
  switch (status) {
    case "in_sync":
      return "healthy"
    case "core_dirty":
      return "pending"
    case "google_dirty":
      return "attention"
    case "conflict":
      return "at-risk"
    case "unknown":
      return "neutral"
  }
}

/** Org-wide roll-up for a board caption. */
export function summariseListingHealth(
  healths: readonly ListingHealth[]
): string {
  if (healths.length === 0) return "No listings yet"
  const attention = healths.filter(
    (health) =>
      health === "attention" ||
      health === "disconnected" ||
      health === "access_lost"
  ).length
  const unpublished = healths.filter(
    (health) => health === "unpublished"
  ).length
  const parts: string[] = []
  if (attention > 0)
    parts.push(
      attention === 1 ? "1 needs attention" : `${attention} need attention`
    )
  if (unpublished > 0)
    parts.push(
      unpublished === 1
        ? "1 has changes to publish"
        : `${unpublished} have changes to publish`
    )
  return parts.length ? parts.join(" · ") : "Every listing is in sync"
}
