import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LocationPerformance } from "@/components/performance/location-performance"

const ZERO_TOTALS = { BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 0, BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 0, BUSINESS_IMPRESSIONS_MOBILE_MAPS: 0, BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 0, CALL_CLICKS: 0, WEBSITE_CLICKS: 0, BUSINESS_DIRECTION_REQUESTS: 0, BUSINESS_CONVERSATIONS: 0, BUSINESS_BOOKINGS: 0, BUSINESS_FOOD_ORDERS: 0, BUSINESS_FOOD_MENU_CLICKS: 0 }

function routeBody(url: string) {
  if (url.startsWith("/api/analytics/overview")) {
    return { from: "a", to: "b", timezone: "Europe/London", summary: { reviewVolume: 0, averageRating: null, responseRate: null, unresolvedComplaints: 0, verificationFailures: 0, verificationRejectionRate: null, medianFirstResponseSeconds: null, p95FirstResponseSeconds: null, medianLatestEditSeconds: null }, series: [], locations: [{ id: "loc-1", name: "Riverside", reviews: 12, averageRating: 4.5, responseRate: 88, medianFirstResponseSeconds: 3600, p95FirstResponseSeconds: null, medianLatestEditSeconds: null, unresolvedComplaints: 1, verificationRejectionRate: null }], providerTotals: { averageRating: null, totalReviewCount: null, localReviewCount: 0, divergence: false } }
  }
  if (url.startsWith("/api/analytics/presence/keywords")) {
    return { range: "6m", from: "2026-03-01", state: "empty", locations: [{ id: "loc-1", name: "Riverside" }], keywords: [], unavailableReasons: [] }
  }
  return { range: "28d", from: "a", to: "b", state: "empty", freshThrough: null, locations: [{ id: "loc-1", name: "Riverside" }], totals: ZERO_TOTALS, series: [], unavailableReasons: [], keywordsEnabled: false, ingestionEnabled: true }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function renderPerf() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(routeBody(url)), { headers: { "content-type": "application/json" } })))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><LocationPerformance locationId="loc-1" /></QueryClientProvider>)
}

describe("LocationPerformance", () => {
  it("derives the review tiles from the matching overview.locations row", async () => {
    renderPerf()
    expect(await screen.findByText("Reviews")).toBeInTheDocument()
    expect(screen.getByText("12")).toBeInTheDocument()
    expect(screen.getByText("4.5")).toBeInTheDocument()
  })

  it("shows an honest no-activity panel when the location is absent from overview", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const body = url.startsWith("/api/analytics/overview")
        ? { from: "a", to: "b", timezone: "Europe/London", summary: { reviewVolume: 0, averageRating: null, responseRate: null, unresolvedComplaints: 0, verificationFailures: 0, verificationRejectionRate: null, medianFirstResponseSeconds: null, p95FirstResponseSeconds: null, medianLatestEditSeconds: null }, series: [], locations: [], providerTotals: { averageRating: null, totalReviewCount: null, localReviewCount: 0, divergence: false } }
        : routeBody(url)
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><LocationPerformance locationId="loc-1" /></QueryClientProvider>)
    expect(await screen.findByText(/no review activity/i)).toBeInTheDocument()
  })
})
