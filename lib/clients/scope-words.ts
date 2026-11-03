import { healthLabel, type ClientHealth } from "@/lib/clients/health"
import { formatNumber } from "@/lib/format/number"

/**
 * The words every scope surface uses for a client: the phone's "Working on"
 * sheet, the desk menu and searchable list, and the scope control itself
 * (components/app-shell/scope-sheet-model.tsx `useScopeControl`). Pure and
 * dependency-light, so the lazily loaded search list can share them.
 */

/** "9 listings", "1 listing". */
export function listingCountWords(count: number): string {
  return `${formatNumber(count)} ${count === 1 ? "listing" : "listings"}`
}

/**
 * A client's line: its listings and its health in words, "9 listings · 1
 * needs attention" (DIRECTION §4). A dot beside it only repeats the tone.
 */
export function clientScopeWords(client: {
  locationCount: number
  health: ClientHealth
}): string {
  return `${listingCountWords(client.locationCount)} · ${healthLabel(client.health)}`
}
