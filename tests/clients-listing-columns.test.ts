import { describe, expect, it } from "vitest"

import { listingWaiting } from "@/lib/clients/listing-columns"
import type { ListingSummary } from "@/lib/contracts/location-summary"

function area(status: string, dirtyCount = 0) {
  return {
    status,
    dirtyCount,
    observedAt: null,
    checkStatus: "unchecked",
  }
}

function summaryWith(overrides: Record<string, unknown>): ListingSummary {
  return {
    linked: true,
    verified: true,
    profile: area("in_sync"),
    hours: area("in_sync"),
    menu: { ...area("in_sync"), eligible: true },
    suggestions: { profile: 0, foodMenus: 0 },
    posts: { awaitingApproval: 0, failed: 0 },
    ...overrides,
  } as unknown as ListingSummary
}

describe("listingWaiting", () => {
  it("is zero when nothing is waiting", () => {
    expect(listingWaiting(summaryWith({}))).toBe(0)
  })

  it("adds unpublished edits, Google's changes and suggestions, and posts to approve", () => {
    expect(
      listingWaiting(
        summaryWith({
          profile: area("core_dirty", 2),
          hours: area("google_dirty"),
          suggestions: { profile: 1, foodMenus: 1 },
          posts: { awaitingApproval: 2, failed: 0 },
        })
      )
    ).toBe(2 + 1 + 2 + 2)
  })
})
