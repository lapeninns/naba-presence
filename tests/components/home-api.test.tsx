import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchAnalyticsOverview } from "@/lib/api/analytics"
import { fetchReviewCounts } from "@/lib/api/review-counts"

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("fetchReviewCounts", () => {
  it("returns total and byStatus from the counts endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        total: 5,
        byStatus: { new: 2, drafted: 1, escalated: 1, failed: 1 },
        byQueue: { needs_reply: 0, awaiting_my_approval: 0, awaiting_others: 0, publishing: 0, failed: 0, done: 0, all: 0 },
      })
    )
    vi.stubGlobal("fetch", fetchMock)
    const counts = await fetchReviewCounts()
    expect(counts.total).toBe(5)
    expect(counts.byStatus.new).toBe(2)
    expect(counts.byStatus.escalated).toBe(1)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reviews/counts",
      expect.anything()
    )
  })

  it("throws malformed_response when the shape is wrong", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ total: "five", byStatus: {}, byQueue: { needs_reply: 0, awaiting_my_approval: 0, awaiting_others: 0, publishing: 0, failed: 0, done: 0, all: 0 } }))
    )
    await expect(fetchReviewCounts()).rejects.toMatchObject({
      code: "malformed_response",
    })
  })
})

describe("fetchAnalyticsOverview", () => {
  it("keeps the fields Home consumes and tolerates the rest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          from: "2026-07-01T00:00:00.000Z",
          to: "2026-07-31T00:00:00.000Z",
          timezone: "Europe/London",
          summary: {
            reviewVolume: 12,
            averageRating: 4.27,
            responseRate: 83.3,
            unresolvedComplaints: 4,
            verificationFailures: 0,
            verificationRejectionRate: null,
            medianFirstResponseSeconds: 3600,
            p95FirstResponseSeconds: null,
            medianLatestEditSeconds: null,
          },
          series: [
            { period: "2026-07-01", reviewCount: 1, reviews: 1, replies: 0, averageRating: 5 },
          ],
          locations: [
            {
              id: "loc-1", name: "Riverside", reviews: 8, averageRating: 4.1, responseRate: 75,
              medianFirstResponseSeconds: null, p95FirstResponseSeconds: null, medianLatestEditSeconds: null,
              unresolvedComplaints: 3, verificationRejectionRate: null,
            },
            {
              id: "loc-2", name: "Old Town", reviews: 4, averageRating: 4.6, responseRate: 100,
              medianFirstResponseSeconds: null, p95FirstResponseSeconds: null, medianLatestEditSeconds: null,
              unresolvedComplaints: 0, verificationRejectionRate: null,
            },
          ],
          providerTotals: { averageRating: 4.3, totalReviewCount: 20, localReviewCount: 12, divergence: false },
        })
      )
    )
    const overview = await fetchAnalyticsOverview()
    expect(overview.timezone).toBe("Europe/London")
    expect(overview.summary.averageRating).toBe(4.27)
    expect(overview.summary.responseRate).toBe(83.3)
    expect(overview.locations).toHaveLength(2)
    expect(overview.locations[0]).toMatchObject({
      id: "loc-1",
      name: "Riverside",
      unresolvedComplaints: 3,
    })
  })

  it("accepts null summary metrics for an org with no reviews", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          from: "2026-07-01T00:00:00.000Z",
          to: "2026-07-31T00:00:00.000Z",
          timezone: "UTC",
          summary: {
            reviewVolume: 0,
            averageRating: null,
            responseRate: null,
            unresolvedComplaints: 0,
            verificationFailures: 0,
            verificationRejectionRate: null,
            medianFirstResponseSeconds: null,
            p95FirstResponseSeconds: null,
            medianLatestEditSeconds: null,
          },
          series: [],
          locations: [],
          providerTotals: { averageRating: null, totalReviewCount: null, localReviewCount: 0, divergence: false },
        })
      )
    )
    const overview = await fetchAnalyticsOverview()
    expect(overview.summary.averageRating).toBeNull()
    expect(overview.summary.responseRate).toBeNull()
    expect(overview.locations).toEqual([])
  })
})
