import { describe, expect, it } from "vitest"

import {
  isSettling,
  restartSettlingClock,
  settlingBackoff,
  settlingInterval,
  SETTLING_POLL_CAP_MS,
  SETTLING_POLL_MS,
} from "@/lib/inbox/settling"

describe("isSettling", () => {
  it("names the one status a background job moves on", () => {
    // The reply route returns 200 with a pending outcome and the publish
    // worker takes it from there; nothing about that reaches the browser.
    expect(isSettling("publish_requested")).toBe(true)
  })

  it("does not poll for states the operator or Google has already settled", () => {
    for (const status of [
      "new",
      "drafted",
      "verified",
      "awaiting_approval",
      "published",
      "failed",
      "rejected",
    ]) {
      expect(isSettling(status)).toBe(false)
    }
  })

  it("treats a missing status as settled rather than polling forever", () => {
    expect(isSettling(null)).toBe(false)
    expect(isSettling(undefined)).toBe(false)
  })
})

describe("settlingInterval", () => {
  it("polls while any row is still on its way to Google", () => {
    expect(settlingInterval(["published", "publish_requested"])).toBe(
      SETTLING_POLL_MS
    )
  })

  it("stops once nothing is in flight", () => {
    // Left running, this would poll the whole inbox every five seconds for as
    // long as the tab is open.
    expect(settlingInterval(["published", "failed"])).toBe(false)
    expect(settlingInterval([])).toBe(false)
  })
})

// W1-F3: the poll was unbounded — a reply stuck in `publish_requested` kept
// every loaded list page and the counts polling every 5 s for as long as the
// tab stayed open.
describe("the settling back-off", () => {
  it("backs off 5 s → 15 s → 60 s and stops at the cap", () => {
    expect(settlingBackoff(0)).toBe(SETTLING_POLL_MS)
    expect(settlingBackoff(29_999)).toBe(5_000)
    expect(settlingBackoff(30_000)).toBe(15_000)
    expect(settlingBackoff(2 * 60_000)).toBe(60_000)
    expect(settlingBackoff(SETTLING_POLL_CAP_MS - 1)).toBe(60_000)
    expect(settlingBackoff(SETTLING_POLL_CAP_MS)).toBe(false)
  })

  it("times each query from when it first saw something settling", () => {
    const query = {}
    const start = 1_000_000
    expect(settlingInterval(["publish_requested"], query, start)).toBe(5_000)
    expect(settlingInterval(["publish_requested"], query, start + 60_000)).toBe(
      15_000
    )
    expect(
      settlingInterval(
        ["publish_requested"],
        query,
        start + SETTLING_POLL_CAP_MS
      )
    ).toBe(false)
  })

  it("starts over once the query settles and something new is in flight", () => {
    const query = {}
    const start = 2_000_000
    settlingInterval(["publish_requested"], query, start)
    expect(settlingInterval(["published"], query, start + 1_000)).toBe(false)
    expect(
      settlingInterval(
        ["publish_requested"],
        query,
        start + SETTLING_POLL_CAP_MS + 1_000
      )
    ).toBe(5_000)
  })

  it("starts over after a review write, even for a query that gave up", () => {
    const query = {}
    const start = 3_000_000
    settlingInterval(["publish_requested"], query, start)
    const later = start + SETTLING_POLL_CAP_MS
    expect(settlingInterval(["publish_requested"], query, later)).toBe(false)
    restartSettlingClock()
    expect(settlingInterval(["publish_requested"], query, later)).toBe(5_000)
  })
})
