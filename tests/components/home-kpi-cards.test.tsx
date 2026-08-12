import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { HealthKpis } from "@/components/home/health-kpis"
import { OverviewView } from "@/components/home/overview-view"
import * as healthHook from "@/lib/queries/use-connection-health"

function jsonFor(url: string) {
  if (url.startsWith("/api/reviews/counts")) {
    return {
      total: 42,
      byStatus: { new: 2, escalated: 1, failed: 0, published: 30 },
    }
  }
  if (url.startsWith("/api/google/connections")) {
    return { connections: [{ id: "c1", status: "active" }] }
  }
  return {
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
      {
        period: "2026-07-15T00:00:00.000Z",
        reviewCount: 1,
        reviews: 1,
        replies: 1,
        averageRating: 4,
      },
    ],
    locations: [],
    providerTotals: {
      averageRating: 4.4,
      totalReviewCount: 51,
      localReviewCount: 42,
      divergence: false,
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  )
}

describe("Health KPIs from the 30-day summary", () => {
  it("renders the four health labels including median response time", async () => {
    vi.spyOn(healthHook, "useConnectionHealth").mockReturnValue({
      status: "connected",
      label: "Live data",
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(JSON.stringify(jsonFor(url)), {
            headers: { "content-type": "application/json" },
          })
      )
    )
    renderWithClient(<OverviewView />)
    expect(await screen.findByText("Reviews received")).toBeInTheDocument()
    expect(screen.getByText("Average rating")).toBeInTheDocument()
    expect(screen.getByText("Response rate")).toBeInTheDocument()
    expect(screen.getByText("Median response time")).toBeInTheDocument()
    expect(screen.getByText("1h 30m")).toBeInTheDocument()
    expect(screen.queryByText("Total reviews")).not.toBeInTheDocument()
  })

  it("renders HealthKpis directly from a summary", () => {
    render(
      <HealthKpis
        summary={{
          reviewVolume: 10,
          averageRating: 4.5,
          responseRate: 90,
          unresolvedComplaints: 0,
          verificationFailures: 0,
          verificationRejectionRate: null,
          medianFirstResponseSeconds: 3600,
          p95FirstResponseSeconds: null,
          medianLatestEditSeconds: null,
        }}
      />
    )
    expect(screen.getByText("Reviews received")).toBeInTheDocument()
    expect(screen.getByText("10")).toBeInTheDocument()
    expect(screen.getByText("4.5")).toBeInTheDocument()
    expect(screen.getByText("90%")).toBeInTheDocument()
    expect(screen.getByText("1h 0m")).toBeInTheDocument()
  })
})
