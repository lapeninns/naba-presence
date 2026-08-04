import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReplyLocationsTable } from "@/components/performance/reply-locations-table"
import { ReplyPerformanceTab } from "@/components/performance/reply-performance-tab"

function locationRow(id: string, name: string) {
  return {
    id,
    name,
    reviews: 4,
    averageRating: 4.5,
    responseRate: 80,
    medianFirstResponseSeconds: 3600,
    p95FirstResponseSeconds: null,
    medianLatestEditSeconds: null,
    unresolvedComplaints: 0,
    verificationRejectionRate: null,
  }
}

function stubOverview(locations: ReturnType<typeof locationRow>[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            from: "2026-01-01T00:00:00.000Z",
            to: "2026-01-31T00:00:00.000Z",
            timezone: "Europe/London",
            summary: {
              reviewVolume: 4,
              averageRating: 4.5,
              responseRate: 80,
              unresolvedComplaints: 0,
              verificationFailures: 0,
              verificationRejectionRate: null,
              medianFirstResponseSeconds: 3600,
              p95FirstResponseSeconds: null,
              medianLatestEditSeconds: null,
            },
            series: [],
            locations,
            providerTotals: {
              averageRating: null,
              totalReviewCount: null,
              localReviewCount: 4,
              divergence: false,
            },
          }),
          { headers: { "content-type": "application/json" } }
        )
    )
  )
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ReplyPerformanceTab />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("ReplyPerformanceTab by-location card", () => {
  it("hides the by-location breakdown for a single-location org", async () => {
    // One row would just restate the stat tiles directly above it.
    stubOverview([locationRow("a", "Old Crown Girton")])
    renderTab()
    await screen.findByRole("heading", { name: "Review volume" })
    expect(
      screen.queryByRole("heading", { name: "By location" })
    ).not.toBeInTheDocument()
  })

  it("shows the by-location breakdown once there is something to compare", async () => {
    stubOverview([locationRow("a", "Alpha"), locationRow("b", "Bravo")])
    renderTab()
    expect(
      await screen.findByRole("heading", { name: "By location" })
    ).toBeInTheDocument()
  })
})

describe("ReplyLocationsTable nulls-last honest-null (spec §8)", () => {
  it("sorts rows with null response rate last and renders — for nulls", () => {
    render(
      <ReplyLocationsTable
        locations={[
          { id: "a", name: "Alpha", reviews: 3, averageRating: 4.2, responseRate: null, medianFirstResponseSeconds: null, p95FirstResponseSeconds: null, medianLatestEditSeconds: null, unresolvedComplaints: 0, verificationRejectionRate: null },
          { id: "b", name: "Bravo", reviews: 9, averageRating: 4.8, responseRate: 91, medianFirstResponseSeconds: 3600, p95FirstResponseSeconds: null, medianLatestEditSeconds: null, unresolvedComplaints: 1, verificationRejectionRate: null },
        ]}
      />
    )
    const rows = screen.getAllByRole("row").slice(1) // drop header
    expect(within(rows[0]).getByText("Bravo")).toBeInTheDocument() // non-null response rate first
    expect(within(rows[1]).getByText("Alpha")).toBeInTheDocument() // null last
    expect(within(rows[1]).getAllByText("—").length).toBeGreaterThan(0)
  })
})
