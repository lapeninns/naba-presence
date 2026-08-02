import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { KpiCards } from "@/components/home/kpi-cards"

function jsonFor(url: string) {
  if (url.startsWith("/api/reviews/counts")) {
    return { total: 42, byStatus: { new: 2, escalated: 1, failed: 0, published: 30 } }
  }
  return {
    from: "2026-07-03T00:00:00.000Z", to: "2026-08-02T00:00:00.000Z", timezone: "Europe/London",
    summary: {
      reviewVolume: 42, averageRating: 4.36, responseRate: 88.5, unresolvedComplaints: 3,
      verificationFailures: 1, verificationRejectionRate: 12.5,
      medianFirstResponseSeconds: 5400, p95FirstResponseSeconds: 86400, medianLatestEditSeconds: null,
    },
    series: [], locations: [],
    providerTotals: { averageRating: 4.4, totalReviewCount: 51, localReviewCount: 42, divergence: false },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

describe("KpiCards widened to the full summary", () => {
  it("keeps the e2e-asserted labels and adds response-time + complaints", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(jsonFor(url)), { headers: { "content-type": "application/json" } })))
    renderWithClient(<KpiCards />)
    expect(await screen.findByText("Total reviews")).toBeInTheDocument()
    expect(screen.getByText("Average rating")).toBeInTheDocument()
    expect(screen.getByText("Response rate")).toBeInTheDocument()
    expect(screen.getByText("Needs attention")).toBeInTheDocument()
    // Widened tiles:
    expect(screen.getByText("Median response time")).toBeInTheDocument()
    expect(screen.getByText("1h 30m")).toBeInTheDocument() // 5400s
    expect(screen.getByText("Unresolved complaints")).toBeInTheDocument()
  })
})
