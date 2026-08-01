import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseQueryResult } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { KpiCards } from "@/components/home/kpi-cards"
import type { AnalyticsOverview } from "@/lib/api/analytics"
import type { ReviewCounts } from "@/lib/api/review-counts"
import * as analyticsHook from "@/lib/queries/use-analytics-overview"
import * as countsHook from "@/lib/queries/use-review-counts"

function fakeCounts(value: Partial<UseQueryResult<ReviewCounts>>) {
  vi.spyOn(countsHook, "useReviewCounts").mockReturnValue(
    value as UseQueryResult<ReviewCounts>
  )
}
function fakeAnalytics(value: Partial<UseQueryResult<AnalyticsOverview>>) {
  vi.spyOn(analyticsHook, "useAnalyticsOverview").mockReturnValue(
    value as UseQueryResult<AnalyticsOverview>
  )
}

const fullByStatus = {
  new: 3,
  drafted: 2,
  verified: 1,
  awaiting_approval: 0,
  publish_requested: 0,
  published: 5,
  rejected: 0,
  failed: 2,
  escalated: 4,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("KpiCards", () => {
  it("shows a busy skeleton row while either query is pending", () => {
    fakeCounts({ isPending: true, isError: false })
    fakeAnalytics({
      isPending: false,
      isError: false,
      data: { timezone: "UTC", summary: { averageRating: 4, responseRate: 80 }, locations: [] },
    })
    const { container } = render(<KpiCards />)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByText("Average rating")).not.toBeInTheDocument()
  })

  it("renders the four KPIs from counts and analytics", () => {
    fakeCounts({
      isPending: false,
      isError: false,
      data: { total: 1234, byStatus: fullByStatus },
    })
    fakeAnalytics({
      isPending: false,
      isError: false,
      data: { timezone: "Europe/London", summary: { averageRating: 4.27, responseRate: 83.3 }, locations: [] },
    })
    render(<KpiCards />)
    expect(screen.getByText("Total reviews")).toBeInTheDocument()
    expect(screen.getByText("1,234")).toBeInTheDocument()
    expect(screen.getByText("Needs attention")).toBeInTheDocument()
    // new(3) + escalated(4) + failed(2) = 9
    expect(screen.getByText("9")).toBeInTheDocument()
    expect(screen.getByText("Average rating")).toBeInTheDocument()
    expect(screen.getByText("4.3")).toBeInTheDocument()
    expect(screen.getByText("Response rate")).toBeInTheDocument()
    expect(screen.getByText("83%")).toBeInTheDocument()
  })

  it("renders an honest zero/empty state without inventing data", () => {
    fakeCounts({
      isPending: false,
      isError: false,
      data: {
        total: 0,
        byStatus: {
          new: 0, drafted: 0, verified: 0, awaiting_approval: 0,
          publish_requested: 0, published: 0, rejected: 0, failed: 0, escalated: 0,
        },
      },
    })
    fakeAnalytics({
      isPending: false,
      isError: false,
      data: { timezone: "UTC", summary: { averageRating: null, responseRate: null }, locations: [] },
    })
    render(<KpiCards />)
    expect(screen.getByText("Total reviews")).toBeInTheDocument()
    expect(screen.getAllByText("0")).toHaveLength(2)
    expect(screen.getAllByText("—")).toHaveLength(2)
  })

  it("offers a retry that refetches both sources when either errors", async () => {
    const user = userEvent.setup()
    const countsRefetch = vi.fn()
    const analyticsRefetch = vi.fn()
    fakeCounts({
      isPending: false,
      isError: true,
      refetch: countsRefetch as UseQueryResult<ReviewCounts>["refetch"],
    })
    fakeAnalytics({
      isPending: false,
      isError: false,
      refetch: analyticsRefetch as UseQueryResult<AnalyticsOverview>["refetch"],
      data: { timezone: "UTC", summary: { averageRating: 4, responseRate: 80 }, locations: [] },
    })
    render(<KpiCards />)
    expect(
      screen.getByText("We could not load your Home summary.")
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(countsRefetch).toHaveBeenCalledTimes(1)
    expect(analyticsRefetch).toHaveBeenCalledTimes(1)
  })
})
