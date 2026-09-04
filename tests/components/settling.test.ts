import { describe, expect, it } from "vitest"

import {
  isSettling,
  settlingInterval,
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
