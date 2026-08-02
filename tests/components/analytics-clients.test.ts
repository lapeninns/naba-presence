import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchAnalyticsOverview } from "@/lib/api/analytics"
import { fetchKeywords } from "@/lib/api/keywords"
import { fetchPresence } from "@/lib/api/presence"
import { fetchSession } from "@/lib/api/session"
import { triggerPerformanceSync } from "@/lib/api/sync"
import { ApiClientError } from "@/lib/api/client"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const OVERVIEW = {
  from: "2026-07-03T00:00:00.000Z",
  to: "2026-08-02T00:00:00.000Z",
  timezone: "Europe/London",
  summary: {
    reviewVolume: 42,
    averageRating: 4.36,
    responseRate: 88.5,
    unresolvedComplaints: 3,
    verificationFailures: 1,
    verificationRejectionRate: 12.5,
    medianFirstResponseSeconds: 5400,
    p95FirstResponseSeconds: 86400,
    medianLatestEditSeconds: null,
  },
  series: [
    { period: "2026-07-03T00:00:00.000Z", reviewCount: 2, reviews: 2, replies: 1, averageRating: 4.5 },
    { period: "2026-07-04T00:00:00.000Z", reviewCount: 0, reviews: 0, replies: 0, averageRating: null },
  ],
  locations: [
    {
      id: "loc-1", name: "Riverside", reviews: 20, averageRating: 4.6, responseRate: 90,
      medianFirstResponseSeconds: 4200, p95FirstResponseSeconds: 80000, medianLatestEditSeconds: null,
      unresolvedComplaints: 1, verificationRejectionRate: null,
    },
  ],
  providerTotals: { averageRating: 4.4, totalReviewCount: 51, localReviewCount: 42, divergence: true },
}

describe("fetchAnalyticsOverview (widened)", () => {
  it("preserves series, providerTotals, and every summary + per-location field", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(OVERVIEW)))
    const result = await fetchAnalyticsOverview()
    expect(result.series).toHaveLength(2)
    expect(result.series[1].averageRating).toBeNull()
    expect(result.providerTotals.divergence).toBe(true)
    expect(result.summary.medianFirstResponseSeconds).toBe(5400)
    expect(result.summary.medianLatestEditSeconds).toBeNull()
    expect(result.locations[0].responseRate).toBe(90)
    expect(result.locations[0].verificationRejectionRate).toBeNull()
  })
  it("passes from/to/granularity through the query string", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(OVERVIEW))
    vi.stubGlobal("fetch", fetchMock)
    await fetchAnalyticsOverview({ from: "2026-06-01T00:00:00.000Z", to: "2026-07-01T00:00:00.000Z", granularity: "week" })
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://t")
    expect(url.pathname).toBe("/api/analytics/overview")
    expect(url.searchParams.get("granularity")).toBe("week")
    expect(url.searchParams.get("from")).toBe("2026-06-01T00:00:00.000Z")
  })
})

describe("fetchPresence", () => {
  it("parses the state envelope, zero-filled totals, and partial series", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          range: "28d", from: "2026-07-05", to: "2026-08-02", state: "ready", freshThrough: "2026-08-01",
          locations: [{ id: "loc-1", name: "Riverside" }],
          totals: { BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 10, BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 0, BUSINESS_IMPRESSIONS_MOBILE_MAPS: 0, BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 0, CALL_CLICKS: 5, WEBSITE_CLICKS: 7, BUSINESS_DIRECTION_REQUESTS: 0, BUSINESS_CONVERSATIONS: 0, BUSINESS_BOOKINGS: 0, BUSINESS_FOOD_ORDERS: 0, BUSINESS_FOOD_MENU_CLICKS: 0 },
          series: [{ date: "2026-08-01", metrics: { CALL_CLICKS: 5 } }],
          unavailableReasons: [], keywordsEnabled: false, ingestionEnabled: true,
        })
      )
    )
    const result = await fetchPresence({ range: "28d" })
    expect(result.state).toBe("ready")
    expect(result.totals.CALL_CLICKS).toBe(5)
    expect(result.series[0].metrics.CALL_CLICKS).toBe(5)
    expect(result.ingestionEnabled).toBe(true)
  })
  it("forwards locationId when given", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ range: "28d", from: "2026-07-05", to: "2026-08-02", state: "no_link", freshThrough: null, locations: [], totals: { BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 0, BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 0, BUSINESS_IMPRESSIONS_MOBILE_MAPS: 0, BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 0, CALL_CLICKS: 0, WEBSITE_CLICKS: 0, BUSINESS_DIRECTION_REQUESTS: 0, BUSINESS_CONVERSATIONS: 0, BUSINESS_BOOKINGS: 0, BUSINESS_FOOD_ORDERS: 0, BUSINESS_FOOD_MENU_CLICKS: 0 }, series: [], unavailableReasons: [], keywordsEnabled: false, ingestionEnabled: true })
    )
    vi.stubGlobal("fetch", fetchMock)
    await fetchPresence({ range: "90d", locationId: "loc-9" })
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://t")
    expect(url.searchParams.get("range")).toBe("90d")
    expect(url.searchParams.get("locationId")).toBe("loc-9")
  })
})

describe("fetchKeywords", () => {
  it("parses keyword rows including the thresholded flag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          range: "6m", from: "2026-03-01", state: "ready", locations: [{ id: "loc-1", name: "Riverside" }],
          keywords: [{ rank: 1, keyword: "riverside hotel", impressions: 1000, upperBound: 9999, thresholded: true, firstMonth: "2026-03", latestMonth: "2026-08" }],
          unavailableReasons: [],
        })
      )
    )
    const result = await fetchKeywords({ range: "6m" })
    expect(result.keywords[0].thresholded).toBe(true)
    expect(result.keywords[0].latestMonth).toBe("2026-08")
  })
  it("rethrows the 503 keywords_paused code without inventing copy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "keywords_paused", message: "paused" }, 503)))
    await expect(fetchKeywords({ range: "6m" })).rejects.toMatchObject({
      constructor: ApiClientError, status: 503, code: "keywords_paused",
    })
  })
})

describe("triggerPerformanceSync", () => {
  it("POSTs an empty body to the sync route", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ organisations: [], skipped: false, nextCursor: null }))
    vi.stubGlobal("fetch", fetchMock)
    await triggerPerformanceSync()
    expect(fetchMock.mock.calls[0][0]).toBe("/api/sync/performance")
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST")
  })
})

describe("fetchSession", () => {
  it("parses the nullable session envelope including role", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ session: { userId: "u1", organisationId: "o1", organisationName: "Org", displayName: "Ada", email: "ada@example.test", role: "admin", canPublish: true } })))
    const result = await fetchSession()
    expect(result.session?.role).toBe("admin")
  })
  it("accepts a null session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ session: null })))
    expect((await fetchSession()).session).toBeNull()
  })
})
