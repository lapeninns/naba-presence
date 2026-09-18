/**
 * Relative review age, and how it gets on with an explicit date range.
 *
 * Two controls can narrow the same two columns: the toolbar's Age preset and
 * More filters' From/To dates. Left to themselves they produce a filter set
 * nobody chose — "last 24 hours" AND "1–31 July" is empty, and neither control
 * looks wrong. So the relationship is stated once, here, and both controls obey
 * it:
 *
 *   · Choosing an Age preset clears `dateFrom` / `dateTo`.
 *   · Typing a custom date clears the Age preset.
 *   · When a URL arrives carrying both — a hand-edited link, or a bookmark
 *     from before this rule — the custom dates win and the preset is ignored.
 *     Dates are the more specific claim, and silently widening someone's
 *     explicit range is the worse failure.
 */

export const REVIEW_AGE_PRESETS = ["24h", "7d", "over7d"] as const
export type ReviewAge = (typeof REVIEW_AGE_PRESETS)[number]

export const REVIEW_AGE_LABELS: Record<ReviewAge, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  over7d: "Older than 7 days",
}

const HOUR_MS = 60 * 60 * 1000
const WINDOW_HOURS: Record<ReviewAge, number> = {
  "24h": 24,
  "7d": 168,
  over7d: 168,
}

export function isReviewAge(
  value: string | null | undefined
): value is ReviewAge {
  return (REVIEW_AGE_PRESETS as readonly string[]).includes(value ?? "")
}

/**
 * The preset as the date range the reviews query already understands.
 *
 * The boundary is quantised to the top of the hour on purpose. `toReviewsFilters`
 * is pure and runs inside a `useMemo`, and the result becomes part of the
 * TanStack Query key: a boundary taken from a live clock would mint a new key on
 * every recomputation and refetch the list — and repaginate it — under the
 * operator's cursor. An hour's granularity is well inside what "last 24 hours"
 * claims, and it holds the list still while someone works it.
 */
export function ageRange(
  age: ReviewAge,
  now: number
): { dateFrom?: string; dateTo?: string } {
  const boundary = new Date(
    Math.floor(now / HOUR_MS) * HOUR_MS - WINDOW_HOURS[age] * HOUR_MS
  ).toISOString()
  return age === "over7d" ? { dateTo: boundary } : { dateFrom: boundary }
}
