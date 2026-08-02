import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseQueryResult } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AttentionList } from "@/components/home/attention-list"
import type { AnalyticsOverview } from "@/lib/api/analytics"
import * as analyticsHook from "@/lib/queries/use-analytics-overview"

function fakeAnalytics(value: Partial<UseQueryResult<AnalyticsOverview>>) {
  vi.spyOn(analyticsHook, "useAnalyticsOverview").mockReturnValue(
    value as UseQueryResult<AnalyticsOverview>
  )
}

// The widened AnalyticsOverview schema (M7) adds fields these fixtures don't
// exercise (series, providerTotals, per-location rate/response-time). These
// helpers backfill honest defaults so the fixtures stay focused on what each
// test actually asserts.
function overview(input: {
  summary: { averageRating: number | null; responseRate: number | null }
  locations: Array<{ id: string; name: string; unresolvedComplaints: number }>
}): AnalyticsOverview {
  return {
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-08-01T00:00:00.000Z",
    timezone: "UTC",
    summary: {
      reviewVolume: 0,
      averageRating: input.summary.averageRating,
      responseRate: input.summary.responseRate,
      unresolvedComplaints: 0,
      verificationFailures: 0,
      verificationRejectionRate: null,
      medianFirstResponseSeconds: null,
      p95FirstResponseSeconds: null,
      medianLatestEditSeconds: null,
    },
    series: [],
    locations: input.locations.map((location) => ({
      ...location,
      reviews: 0,
      averageRating: null,
      responseRate: null,
      medianFirstResponseSeconds: null,
      p95FirstResponseSeconds: null,
      medianLatestEditSeconds: null,
      verificationRejectionRate: null,
    })),
    providerTotals: {
      averageRating: null,
      totalReviewCount: null,
      localReviewCount: 0,
      divergence: false,
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("AttentionList", () => {
  it("is busy while the query is pending", () => {
    fakeAnalytics({ isPending: true, isError: false })
    const { container } = render(<AttentionList />)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it("lists the worst five locations, most complaints first, each linking to its inbox", () => {
    fakeAnalytics({
      isPending: false,
      isError: false,
      data: overview({
        summary: { averageRating: 4, responseRate: 80 },
        locations: [
          { id: "a", name: "Airport", unresolvedComplaints: 1 },
          { id: "b", name: "Bridge", unresolvedComplaints: 9 },
          { id: "c", name: "Central", unresolvedComplaints: 0 },
          { id: "d", name: "Dockside", unresolvedComplaints: 4 },
          { id: "e", name: "Eastgate", unresolvedComplaints: 7 },
          { id: "f", name: "Ferry", unresolvedComplaints: 2 },
          { id: "g", name: "Garden", unresolvedComplaints: 3 },
        ],
      }),
    })
    render(<AttentionList />)
    const links = screen.getAllByRole("link")
    // Central (0) excluded; top five by desc: Bridge9, Eastgate7, Dockside4, Garden3, Ferry2
    expect(links).toHaveLength(5)
    expect(links[0]).toHaveAccessibleName(/Bridge/)
    expect(links[0]).toHaveAttribute("href", "/inbox?locationId=b")
    expect(links[4]).toHaveAccessibleName(/Ferry/)
    expect(screen.queryByText(/Central/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Airport/)).not.toBeInTheDocument()
  })

  it("uses singular copy for a single complaint", () => {
    fakeAnalytics({
      isPending: false,
      isError: false,
      data: overview({
        summary: { averageRating: 4, responseRate: 80 },
        locations: [{ id: "a", name: "Airport", unresolvedComplaints: 1 }],
      }),
    })
    render(<AttentionList />)
    expect(screen.getByText("1 unresolved complaint")).toBeInTheDocument()
  })

  it("shows an honest empty state when nothing needs attention", () => {
    fakeAnalytics({
      isPending: false,
      isError: false,
      data: overview({
        summary: { averageRating: 5, responseRate: 100 },
        locations: [{ id: "a", name: "Airport", unresolvedComplaints: 0 }],
      }),
    })
    render(<AttentionList />)
    expect(
      screen.getByText("No locations need attention right now.")
    ).toBeInTheDocument()
    expect(screen.queryAllByRole("link")).toHaveLength(0)
  })

  it("offers a retry when the query errors", async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    fakeAnalytics({
      isPending: false,
      isError: true,
      refetch: refetch as UseQueryResult<AnalyticsOverview>["refetch"],
    })
    render(<AttentionList />)
    expect(
      screen.getByText("We could not load locations that need attention.")
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})
