import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/server/db", () => ({ getDatabase: vi.fn() }))
vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({
    GOOGLE_RATE_BUDGET_ENABLED: true,
    GOOGLE_API_REQUESTS_PER_MINUTE: 240,
    GOOGLE_LOCATION_EDITS_PER_MINUTE: 8,
  }),
}))

const {
  budgetsFor,
  windowCapacity,
  worstRollingMinute,
  worstRollingMinuteOfEdits,
} = await import("@/lib/server/google/rate-budget")

describe("shared Google rate budget", () => {
  it("keeps every rolling minute under Google's hard limits", () => {
    // 300 requests per minute per API; 10 edits per minute per profile.
    expect(worstRollingMinute(240)).toBeLessThanOrEqual(300)
    expect(worstRollingMinuteOfEdits(8)).toBeLessThanOrEqual(10)
    expect(worstRollingMinuteOfEdits(10)).toBeLessThanOrEqual(10)
    expect(windowCapacity(240)).toBe(40)
    expect(windowCapacity(1)).toBe(1)
  })

  it("draws Business Profile reads from their API's budget only", () => {
    expect(
      budgetsFor(
        "https://mybusiness.googleapis.com/v4/accounts/1/locations/42/reviews",
        "safe"
      )
    ).toEqual([
      expect.objectContaining({ bucket: "mybusiness.googleapis.com", perMinute: 240 }),
    ])
  })

  it("does not count a review reply against the profile's edit limit", () => {
    expect(
      budgetsFor(
        "https://mybusiness.googleapis.com/v4/accounts/1/locations/42/reviews/abc/reply",
        "mutation"
      ).map((budget) => budget.bucket)
    ).toEqual(["mybusiness.googleapis.com"])
  })

  it("adds the profile's edit budget to a write", () => {
    expect(
      budgetsFor(
        "https://mybusinessbusinessinformation.googleapis.com/v1/locations/42?updateMask=title",
        "mutation"
      )
    ).toEqual([
      expect.objectContaining({
        bucket: "mybusinessbusinessinformation.googleapis.com",
        capacity: 40,
        windowSeconds: 10,
      }),
      expect.objectContaining({
        bucket: "edit:locations/42",
        capacity: 4,
        windowSeconds: 60,
      }),
    ])
  })

  it("leaves OAuth and OpenID endpoints outside the budget", () => {
    expect(budgetsFor("https://oauth2.googleapis.com/token", "safe")).toEqual([])
    expect(
      budgetsFor("https://openidconnect.googleapis.com/v1/userinfo", "safe")
    ).toEqual([])
  })
})
