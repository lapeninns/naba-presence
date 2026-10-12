import "server-only"

import { stableGoogleHash } from "@/lib/server/gbp-management"

const TIME_KEYS = new Set(["openTime", "closeTime"])

/** Google omits zero fields (`{hours: 9}` for 09:00) and `closed: false`; compare values, not spellings. */
export function normaliseForComparison(value: unknown): unknown {
  if (Array.isArray(value))
    return value
      .map(normaliseForComparison)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  if (!value || typeof value !== "object") return value
  const entries = Object.entries(value as Record<string, unknown>).flatMap(
    ([key, entry]): Array<[string, unknown]> => {
      if (entry === undefined || entry === null) return []
      if (TIME_KEYS.has(key) && typeof entry === "object") {
        const time = entry as { hours?: number; minutes?: number }
        return [[key, { hours: time.hours ?? 0, minutes: time.minutes ?? 0 }]]
      }
      if (key === "closed") return entry === true ? [[key, true]] : []
      return [[key, normaliseForComparison(entry)]]
    }
  )
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)))
}

/** The hash a frozen baseline and a fresh read are compared by. */
export const comparisonHash = (value: unknown) =>
  stableGoogleHash(normaliseForComparison(value))
