import {
  healthLabel,
  healthTone,
  summariseHealth,
  type ClientHealth,
  type HealthTone,
} from "@/lib/clients/health"
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

/** The words a stale roll-up says instead of its numbers. */
export const STALE_HEALTH_WORDS = "Data may be stale"

/**
 * The scope's health in words, with the tone its dot repeats. The one
 * function behind every shell surface that says it: the sidebar's
 * "Working on" button, the tablet top-bar pill, the phone chip, the More
 * sheet's Connections row and the health announcer, so no two sizes word
 * the same data differently (MISSION S3).
 *
 * A scoped client says its own health ("Needs attention"); All clients,
 * or a business, says the roll-up ("1 client needs attention"). A refetch
 * that failed after an earlier success says the numbers are last known.
 * `words` is null while the client list is still loading.
 */
export function scopeHealthWords({
  mode,
  client,
  healths,
  stale = false,
}: {
  mode: "agency" | "business"
  /** The client in scope (agency), or null for All clients and a business. */
  client: { health: ClientHealth } | null
  /** Every client's health, for the roll-up; null while loading. */
  healths: ClientHealth[] | null
  stale?: boolean
}): { tone: HealthTone; words: string | null } {
  if (stale) return { tone: "attention", words: STALE_HEALTH_WORDS }
  if (client && mode === "agency")
    return {
      tone: healthTone(client.health),
      words: healthLabel(client.health),
    }
  if (!healths) return { tone: "neutral", words: null }
  const roll = summariseHealth(healths, mode)
  return { tone: roll.tone, words: roll.label }
}
