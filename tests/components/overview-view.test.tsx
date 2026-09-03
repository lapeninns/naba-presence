import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseQueryResult } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { OverviewView } from "@/components/home/overview-view"
import type { AnalyticsOverview } from "@/lib/api/analytics"
import type { ReviewCounts } from "@/lib/api/review-counts"
import * as analyticsHook from "@/lib/queries/use-analytics-overview"
import * as countsHook from "@/lib/queries/use-review-counts"
import * as healthHook from "@/lib/queries/use-connection-health"

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
function fakeHealth(
  value: Partial<ReturnType<typeof healthHook.useConnectionHealth>> = {}
) {
  vi.spyOn(healthHook, "useConnectionHealth").mockReturnValue({
    status: "connected",
    label: "Live data",
    ...value,
  })
}

function overview(
  summary: Partial<AnalyticsOverview["summary"]> = {}
): AnalyticsOverview {
  return {
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-08-01T00:00:00.000Z",
    timezone: "UTC",
    summary: {
      reviewVolume: 42,
      averageRating: 4.27,
      responseRate: 83.3,
      unresolvedComplaints: 3,
      verificationFailures: 0,
      verificationRejectionRate: null,
      medianFirstResponseSeconds: 5400,
      p95FirstResponseSeconds: null,
      medianLatestEditSeconds: null,
      ...summary,
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
}

const fullByStatus = {
  new: 3,
  drafted: 2,
  verified: 1,
  awaiting_approval: 4,
  publish_requested: 0,
  published: 5,
  rejected: 0,
  failed: 2,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("OverviewView", () => {
  it("shows busy skeletons while either query is pending", () => {
    fakeHealth()
    fakeCounts({ isPending: true, isError: false })
    fakeAnalytics({
      isPending: false,
      isError: false,
      data: overview(),
    })
    const { container } = render(<OverviewView />)
    expect(container.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThan(
      0
    )
    expect(screen.queryByText("Reviews received")).not.toBeInTheDocument()
  })

  it("renders work queues aligned with inbox and 30-day health KPIs", () => {
    fakeHealth()
    fakeCounts({
      isPending: false,
      isError: false,
      data: { total: 21, byStatus: fullByStatus },
    })
    fakeAnalytics({
      isPending: false,
      isError: false,
      data: overview(),
    })
    render(<OverviewView />)

    expect(screen.getByRole("heading", { name: "Your work" })).toBeInTheDocument()
    // needs_reply = new+drafted+verified+failed+rejected = 8
    expect(screen.getByRole("link", { name: /Needs reply/ })).toHaveAttribute(
      "href",
      "/inbox?queue=needs_reply"
    )
    expect(screen.getByRole("link", { name: /Needs reply/ })).toHaveTextContent("8")
    expect(
      screen.getByRole("link", { name: /Awaiting approval/ })
    ).toHaveAttribute("href", "/inbox?queue=awaiting_approval")
    expect(
      screen.getByRole("link", { name: /Unresolved low ratings/ })
    ).toHaveAttribute("href", "/inbox?rating=1,2&replyState=unreplied")

    expect(screen.getByRole("heading", { name: "Health" })).toBeInTheDocument()
    expect(screen.getByText("Reviews received")).toBeInTheDocument()
    expect(screen.getByText("42")).toBeInTheDocument()
    expect(screen.getByText("Average rating")).toBeInTheDocument()
    expect(screen.getByText("4.3")).toBeInTheDocument()
    expect(screen.getByText("Response rate")).toBeInTheDocument()
    expect(screen.getByText("83%")).toBeInTheDocument()
    expect(screen.getByText("Median response time")).toBeInTheDocument()
    expect(screen.getByText("1h 30m")).toBeInTheDocument()

    expect(screen.queryByText("Total reviews")).not.toBeInTheDocument()
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument()
  })

  it("offers a retry that refetches both sources when both fail with no data", async () => {
    const user = userEvent.setup()
    fakeHealth()
    const countsRefetch = vi.fn()
    const analyticsRefetch = vi.fn()
    fakeCounts({
      isPending: false,
      isError: true,
      data: undefined,
      refetch: countsRefetch as UseQueryResult<ReviewCounts>["refetch"],
    })
    fakeAnalytics({
      isPending: false,
      isError: true,
      data: undefined,
      refetch: analyticsRefetch as UseQueryResult<AnalyticsOverview>["refetch"],
    })
    render(<OverviewView />)
    expect(
      screen.getByText("We could not load your Overview.")
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(countsRefetch).toHaveBeenCalledTimes(1)
    expect(analyticsRefetch).toHaveBeenCalledTimes(1)
  })

  it("shows caught-up copy when every work count is zero", () => {
    fakeHealth()
    fakeCounts({
      isPending: false,
      isError: false,
      data: {
        total: 0,
        byStatus: {
          new: 0,
          drafted: 0,
          verified: 0,
          awaiting_approval: 0,
          publish_requested: 0,
          published: 0,
          rejected: 0,
          failed: 0,
        },
      },
    })
    fakeAnalytics({
      isPending: false,
      isError: false,
      data: overview({
        reviewVolume: 0,
        averageRating: null,
        responseRate: null,
        unresolvedComplaints: 0,
        medianFirstResponseSeconds: null,
      }),
    })
    render(<OverviewView />)
    expect(screen.getByText("You’re caught up")).toBeInTheDocument()
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2)
  })
})
