import type { ListingSummary } from "@/lib/contracts/location-summary"

/** The canonical areas Review & publish compares and publishes. */
export type AreaKey = "profile" | "hours" | "menu"

/**
 * Which canonical areas the summary says have local edits to publish. Pure
 * and client-safe: the page's server prefetch uses it to read only those
 * areas from Google (`changesTabPrefetch`), and Review & publish to list them.
 */
export function pendingAreas(summary: ListingSummary): AreaKey[] {
  const dirty = (status: string) =>
    status === "core_dirty" || status === "conflict"
  const areas: AreaKey[] = []
  if (dirty(summary.profile.status)) areas.push("profile")
  if (dirty(summary.hours.status)) areas.push("hours")
  if (dirty(summary.menu.status) && summary.menu.eligible !== false)
    areas.push("menu")
  return areas
}
