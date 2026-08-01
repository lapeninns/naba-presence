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
    const body = { total: 7, byStatus: { new: 3, escalated: 1, failed: 1, published: 2 } }
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
      timezone: "Europe/London",
      summary: { averageRating: 4.2, responseRate: 80 },
      locations: [{ id: "loc-1", name: "Riverside", unresolvedComplaints: 2 }],
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
