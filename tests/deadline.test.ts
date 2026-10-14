import { describe, expect, it } from "vitest"

import {
  DEADLINE_MARGIN_MS,
  hasTimeFor,
  remainingMs,
  requestDeadline,
  timeoutWithin,
} from "@/lib/server/deadline"

describe("request deadlines", () => {
  it("is the start plus maxDuration, less the margin", () => {
    expect(requestDeadline(1_000, 60)).toBe(1_000 + 60_000 - DEADLINE_MARGIN_MS)
  })

  it("counts down to zero and never below", () => {
    expect(remainingMs(10_000, 4_000)).toBe(6_000)
    expect(remainingMs(10_000, 12_000)).toBe(0)
    expect(hasTimeFor(10_000, 6_000, 4_000)).toBe(true)
    expect(hasTimeFor(10_000, 6_001, 4_000)).toBe(false)
  })

  it("sizes a call to its cap, or to what is left after the reserve", () => {
    // No deadline: the per-call cap alone.
    expect(timeoutWithin(undefined, 30_000, 5_000)).toBe(30_000)
    // Plenty of time: the cap.
    expect(timeoutWithin(100_000, 30_000, 5_000, 0)).toBe(30_000)
    // Little time: what is left once the reserve is kept back.
    expect(timeoutWithin(20_000, 30_000, 5_000, 0)).toBe(15_000)
    // None left: 0, and the caller must not start the call.
    expect(timeoutWithin(20_000, 30_000, 5_000, 16_000)).toBe(0)
  })
})
