import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AttentionList } from "@/components/home/attention-list"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

describe("AttentionList low-rated link (spec §8)", () => {
  it("links each row to the location's low-rated reviews in the inbox", async () => {
    const overview = {
      from: "x", to: "y", timezone: "Europe/London",
      summary: { reviewVolume: 0, averageRating: null, responseRate: null, unresolvedComplaints: 0, verificationFailures: 0, verificationRejectionRate: null, medianFirstResponseSeconds: null, p95FirstResponseSeconds: null, medianLatestEditSeconds: null },
      series: [],
      locations: [{ id: "loc-9", name: "Harbour View", reviews: 5, averageRating: 2.1, responseRate: 50, medianFirstResponseSeconds: null, p95FirstResponseSeconds: null, medianLatestEditSeconds: null, unresolvedComplaints: 4, verificationRejectionRate: null }],
      providerTotals: { averageRating: null, totalReviewCount: null, localReviewCount: 0, divergence: false },
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(overview), { headers: { "content-type": "application/json" } })))
    renderWithClient(<AttentionList />)
    const link = await screen.findByRole("link", { name: /Harbour View/ })
    expect(link).toHaveAttribute("href", "/inbox?locationId=loc-9&rating=1,2")
  })
})
