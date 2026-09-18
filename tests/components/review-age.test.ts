import { describe, expect, it } from "vitest"

import {
  REVIEW_AGE_PRESETS,
  ageRange,
  isReviewAge,
} from "@/lib/inbox/review-age"

// A fixed clock, deliberately mid-hour, so the quantisation is visible in
// every expectation below rather than hidden by a round `now`.
const NOW = Date.parse("2026-07-15T14:37:12.480Z")

describe("review age presets", () => {
  it("narrows the recent presets from below, leaving the range open-ended at the top", () => {
    // "Last 24 hours" is a lower bound and nothing else: adding a `dateTo` of
    // "now" would drop a review that arrived while the operator was reading.
    expect(ageRange("24h", NOW)).toEqual({
      dateFrom: "2026-07-14T14:00:00.000Z",
    })
    expect(ageRange("7d", NOW)).toEqual({
      dateFrom: "2026-07-08T14:00:00.000Z",
    })
  })

  it("narrows the backlog preset from above, at the same seven-day boundary", () => {
    // "Older than 7 days" is the complement of "Last 7 days", so the two must
    // meet exactly — otherwise a review can fall into both or neither.
    const recent = ageRange("7d", NOW)
    const backlog = ageRange("over7d", NOW)
    expect(backlog).toEqual({ dateTo: "2026-07-08T14:00:00.000Z" })
    expect(backlog.dateTo).toBe(recent.dateFrom)
    expect(backlog.dateFrom).toBeUndefined()
  })

  it("quantises the boundary to the top of the hour so the range is stable within it", () => {
    // This is the whole reason the quantisation exists. `toReviewsFilters` is
    // pure and runs in a `useMemo`, and its result becomes part of the
    // TanStack Query key: a boundary read from a live clock would mint a new
    // key on every recomputation and refetch — and repaginate — the list under
    // the operator's cursor.
    const earlyInTheHour = Date.parse("2026-07-15T14:00:00.000Z")
    const lateInTheHour = Date.parse("2026-07-15T14:59:59.999Z")
    for (const age of REVIEW_AGE_PRESETS) {
      expect(ageRange(age, earlyInTheHour)).toEqual(
        ageRange(age, lateInTheHour)
      )
      expect(ageRange(age, NOW)).toEqual(ageRange(age, earlyInTheHour))
    }
  })

  it("moves the boundary once the clock crosses into the next hour", () => {
    // The mirror of the case above: quantised is not frozen.
    const nextHour = Date.parse("2026-07-15T15:00:00.000Z")
    expect(ageRange("24h", nextHour)).toEqual({
      dateFrom: "2026-07-14T15:00:00.000Z",
    })
  })

  it("recognises only the three presets, so a hand-edited ?age= is dropped", () => {
    expect(isReviewAge("24h")).toBe(true)
    expect(isReviewAge("7d")).toBe(true)
    expect(isReviewAge("over7d")).toBe(true)
    expect(isReviewAge("30d")).toBe(false)
    expect(isReviewAge(null)).toBe(false)
    expect(isReviewAge(undefined)).toBe(false)
  })
})
