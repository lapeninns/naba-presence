import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { DivergenceBanner } from "@/components/home/divergence-banner"
import { PulseChart } from "@/components/home/pulse-chart"
import type { AnalyticsOverview } from "@/lib/api/analytics"

describe("DivergenceBanner", () => {
  it("renders only when divergence is true", () => {
    const { rerender, container } = render(
      <DivergenceBanner
        providerTotals={{
          averageRating: 4.4,
          totalReviewCount: 51,
          localReviewCount: 42,
          divergence: false,
        }}
      />
    )
    expect(container).toBeEmptyDOMElement()
    rerender(
      <DivergenceBanner
        providerTotals={{
          averageRating: 4.4,
          totalReviewCount: 51,
          localReviewCount: 42,
          divergence: true,
        }}
      />
    )
    expect(screen.getByText(/may be incomplete/i)).toBeInTheDocument()
  })
})

describe("PulseChart", () => {
  it("cross-links to Performance and shows the pulse heading", () => {
    const overview: AnalyticsOverview = {
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
      timezone: "UTC",
      summary: {
        reviewVolume: 2,
        averageRating: 4,
        responseRate: 50,
        unresolvedComplaints: 0,
        verificationFailures: 0,
        verificationRejectionRate: null,
        medianFirstResponseSeconds: null,
        p95FirstResponseSeconds: null,
        medianLatestEditSeconds: null,
      },
      series: [
        {
          period: "2026-07-15T00:00:00.000Z",
          reviewCount: 2,
          reviews: 2,
          replies: 1,
          averageRating: 4,
        },
      ],
      locations: [],
      providerTotals: {
        averageRating: null,
        totalReviewCount: null,
        localReviewCount: 0,
        divergence: false,
      },
    }
    render(
      <PulseChart overview={overview} onRetry={vi.fn()} />
    )
    expect(screen.getByRole("heading", { name: "Pulse" })).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /See Performance/i })
    ).toHaveAttribute("href", "/performance")
  })
})
