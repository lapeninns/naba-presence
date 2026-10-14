import { describe, expect, it } from "vitest"

import {
  EDITOR_FRESHNESS_MS,
  shouldReadLive,
} from "@/lib/server/editor-freshness"
import {
  hoursObservationUnchanged,
  type HoursObservation,
} from "@/lib/server/hours-observations"

const NOW = Date.parse("2026-10-14T12:00:00Z")
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe("shouldReadLive", () => {
  it("serves an observation within the budget", () => {
    expect(shouldReadLive({ observedAt: ago(60_000), now: NOW })).toBe(false)
    expect(
      shouldReadLive({ observedAt: ago(EDITOR_FRESHNESS_MS), now: NOW })
    ).toBe(false)
  })

  it("reads Google when there is no observation, it is stale or unparseable, or on refresh", () => {
    expect(shouldReadLive({ observedAt: null, now: NOW })).toBe(true)
    expect(
      shouldReadLive({ observedAt: ago(EDITOR_FRESHNESS_MS + 1), now: NOW })
    ).toBe(true)
    expect(shouldReadLive({ observedAt: "not a date", now: NOW })).toBe(true)
    expect(
      shouldReadLive({ observedAt: ago(1_000), refresh: true, now: NOW })
    ).toBe(true)
    expect(
      shouldReadLive({ observedAt: ago(10_000), maxAgeMs: 5_000, now: NOW })
    ).toBe(true)
  })

  it("does not trust an observation stamped far in the future", () => {
    expect(
      shouldReadLive({ observedAt: ago(-EDITOR_FRESHNESS_MS - 1), now: NOW })
    ).toBe(true)
  })
})

describe("hoursObservationUnchanged", () => {
  const h = (letter: string) => letter.repeat(64)
  const stored: HoursObservation = {
    locationId: "l1",
    googleHash: h("g"),
    comparisonCanonicalHash: h("c"),
    comparisonGoogleHash: h("g"),
    observedAt: new Date(NOW),
    attemptedAt: new Date(NOW),
    errorCode: null,
    blocked: false,
    observedGoogleParts: { "regular:1": h("1") },
    comparisonParts: {
      complete: true,
      parts: { "regular:1": [h("1"), h("1")] },
    },
  }
  const input = {
    googleHash: h("g"),
    canonicalHash: h("d"),
    baselineCanonicalHash: null,
    baselineGoogleHash: null,
    blocked: false,
    canonicalParts: { "regular:1": h("2") },
    googleParts: { "regular:1": h("1") },
  }

  it("is unchanged for a local edit that leaves every baseline where it is", () => {
    expect(hoursObservationUnchanged(stored, input)).toBe(true)
  })

  it("changes when Google's hash or the blocked flag differs", () => {
    expect(
      hoursObservationUnchanged(stored, { ...input, googleHash: h("x") })
    ).toBe(false)
    expect(hoursObservationUnchanged(stored, { ...input, blocked: true })).toBe(
      false
    )
  })

  it("changes when the schedules now match and the whole baseline would move", () => {
    expect(
      hoursObservationUnchanged(stored, {
        ...input,
        canonicalHash: h("g"),
        canonicalParts: { "regular:1": h("1") },
      })
    ).toBe(false)
  })

  it("changes when a part now matches with a different pair than its baseline", () => {
    expect(
      hoursObservationUnchanged(stored, {
        ...input,
        canonicalParts: { "regular:1": h("1"), "regular:2": h("3") },
        googleParts: { "regular:1": h("1"), "regular:2": h("3") },
      })
    ).toBe(false)
  })

  it("changes when no whole baseline is stored yet", () => {
    expect(
      hoursObservationUnchanged(
        { ...stored, comparisonCanonicalHash: null },
        { ...input, baselineCanonicalHash: h("b") }
      )
    ).toBe(false)
  })
})
