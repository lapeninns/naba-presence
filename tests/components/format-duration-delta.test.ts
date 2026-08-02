import { describe, expect, it } from "vitest"

import { deltaDirection, formatDelta } from "@/lib/format/delta"
import { formatDuration } from "@/lib/format/duration"

describe("formatDuration negative guard (D3)", () => {
  it("returns an em dash for null, non-finite, and negative seconds", () => {
    expect(formatDuration(null)).toBe("—")
    expect(formatDuration(Number.NaN)).toBe("—")
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("—")
    // Clock-skew: a reply stored before the review create_time.
    expect(formatDuration(-120)).toBe("—")
  })
  it("still formats non-negative durations", () => {
    expect(formatDuration(0)).toBe("0m")
    expect(formatDuration(90)).toBe("2m") // rounds first
    expect(formatDuration(3600)).toBe("1h 0m")
    expect(formatDuration(90000)).toBe("1d 1h")
  })
})

describe("delta direction + formatting (non-colour cue source)", () => {
  it("classifies direction and returns null when incomparable", () => {
    expect(deltaDirection(10, 4)).toBe("up")
    expect(deltaDirection(4, 10)).toBe("down")
    expect(deltaDirection(5, 5)).toBe("flat")
    expect(deltaDirection(5, null)).toBeNull()
    expect(deltaDirection(null, 5)).toBeNull()
  })
  it("formats signed magnitude with a unit and a minus glyph, null when incomparable", () => {
    expect(formatDelta(120, 100, { unit: "count" })).toBe("+20")
    expect(formatDelta(96.2, 100, { unit: "percent" })).toBe("−3.8%")
    expect(formatDelta(4.6, 4.4, { unit: "rating" })).toBe("+0.2★")
    // Duration: a faster median response renders as a signed duration, not raw seconds.
    expect(formatDelta(5400, 6600, { unit: "duration" })).toBe("−20m")
    expect(formatDelta(5, 5, { unit: "count" })).toBe("±0")
    expect(formatDelta(5, null)).toBeNull()
  })
  it("renders an em dash for non-finite input, and for a clock-skew negative duration (U6)", () => {
    expect(formatDelta(Number.NaN, 3)).toBe("—")
    expect(formatDelta(3, Number.POSITIVE_INFINITY)).toBe("—")
    // A negative response-time value is clock skew, not a real change — must
    // clamp like formatDuration's own guard, not render a signed duration.
    expect(formatDelta(-1, 5, { unit: "duration" })).toBe("—")
    expect(formatDelta(5, -1, { unit: "duration" })).toBe("—")
  })
})
