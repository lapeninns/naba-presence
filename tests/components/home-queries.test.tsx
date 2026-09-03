import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { queryKeys } from "@/lib/queries/keys"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"
import { useReviewCounts } from "@/lib/queries/use-review-counts"

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function wrapperWith(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("useReviewCounts", () => {
  it("fetches the counts endpoint and caches under the reserved key", async () => {
    const body = {
      total: 7,
      byStatus: { new: 3, escalated: 1, failed: 1, published: 2 },
      byQueue: { needs_reply: 0, awaiting_my_approval: 0, awaiting_others: 0, publishing: 0, failed: 0, done: 0, all: 0 },
    }
    const fetchMock = vi.fn(async () => jsonResponse(body))
    vi.stubGlobal("fetch", fetchMock)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { result } = renderHook(() => useReviewCounts(), {
      wrapper: wrapperWith(client),
    })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data).toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reviews/counts",
      expect.anything()
    )
    expect(client.getQueryData(queryKeys.reviewCounts("organisation"))).toEqual(
      body
    )
  })
})

describe("useAnalyticsOverview", () => {
  it("fetches the overview endpoint and caches under the reserved analytics key", async () => {
    const body = {
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-31T00:00:00.000Z",
      timezone: "Europe/London",
      summary: {
        reviewVolume: 10,
        averageRating: 4.2,
        responseRate: 80,
        unresolvedComplaints: 2,
        verificationFailures: 0,
        verificationRejectionRate: null,
        medianFirstResponseSeconds: null,
        p95FirstResponseSeconds: null,
        medianLatestEditSeconds: null,
      },
      series: [],
      locations: [
        {
          id: "loc-1",
          name: "Riverside",
          reviews: 5,
          averageRating: 4.2,
          responseRate: 80,
          medianFirstResponseSeconds: null,
          p95FirstResponseSeconds: null,
          medianLatestEditSeconds: null,
          unresolvedComplaints: 2,
          verificationRejectionRate: null,
        },
      ],
      providerTotals: {
        averageRating: null,
        totalReviewCount: null,
        localReviewCount: 10,
        divergence: false,
      },
    }
    const fetchMock = vi.fn(async () => jsonResponse(body))
    vi.stubGlobal("fetch", fetchMock)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { result } = renderHook(() => useAnalyticsOverview(), {
      wrapper: wrapperWith(client),
    })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data).toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/analytics/overview",
      expect.anything()
    )
    expect(
      client.getQueryData(
        queryKeys.analytics("overview", { window: "last-30-days" })
      )
    ).toBeDefined()
  })
})
