import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { queryKeys } from "@/lib/queries/keys"
import { flattenReviews, useReviews } from "@/lib/queries/use-reviews"
import { useReviewCounts } from "@/lib/queries/use-review-counts"
import { useReviewDetail } from "@/lib/queries/use-review-detail"

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
function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const row = {
  id: "rev-1",
  location: { id: "loc-1", name: "Riverside" },
  reviewer: { displayName: "Sam", isAnonymous: false, profilePhotoUrl: null },
  rating: 5,
  text: "Lovely",
  detectedLanguageCode: "en",
  languageConfidence: 0.9,
  createTime: "2026-07-30T10:00:00.000Z",
  updateTime: "2026-07-30T10:00:00.000Z",
  hasMedia: false,
  workflowStatus: "new",
  draftId: null,
  draftBody: null,
  verificationStatus: null,
  replyStatus: null,
  googleReplyState: null,
  googlePolicyViolation: null,
  replyBody: null,
  syncStatus: "succeeded",
  capabilities: { canPublish: true, canEdit: true, canRequestApproval: false },
}

describe("useReviews", () => {
  it("fetches the first page and flattens items", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ items: [row], nextCursor: null }))
    )
    const client = newClient()
    const { result } = renderHook(() => useReviews({ locationId: "loc-1" }), {
      wrapper: wrapperWith(client),
    })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(flattenReviews(result.current.data)).toHaveLength(1)
    expect(
      client.getQueryData(queryKeys.reviews("organisation", { locationId: "loc-1" }))
    ).toBeDefined()
  })
})

describe("useReviewCounts", () => {
  it("scopes the key and the query to a locationId", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ total: 1, byStatus: { new: 1 }, byQueue: { needs_reply: 0, awaiting_my_approval: 0, awaiting_others: 0, publishing: 0, failed: 0, done: 0, all: 0 } })
    )
    vi.stubGlobal("fetch", fetchMock)
    const client = newClient()
    const { result } = renderHook(() => useReviewCounts("loc-1"), {
      wrapper: wrapperWith(client),
    })
    await waitFor(() => expect(result.current.data).toBeDefined())
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://t")
    // snake_case on the wire, matching every other review parameter.
    expect(url.searchParams.get("location_id")).toBe("loc-1")
    expect(client.getQueryData(queryKeys.reviewCounts("loc-1"))).toBeDefined()
  })

  it("uses the organisation scope when no location is given", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ total: 0, byStatus: {}, byQueue: { needs_reply: 0, awaiting_my_approval: 0, awaiting_others: 0, publishing: 0, failed: 0, done: 0, all: 0 } })
    )
    vi.stubGlobal("fetch", fetchMock)
    const client = newClient()
    renderHook(() => useReviewCounts(), { wrapper: wrapperWith(client) })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://t")
    expect(url.searchParams.has("locationId")).toBe(false)
  })
})

describe("useReviewDetail", () => {
  it("is disabled without an id and enabled with one", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ review: { id: "rev-1" } })
    )
    vi.stubGlobal("fetch", fetchMock)
    const client = newClient()
    const { rerender } = renderHook(
      ({ id }: { id?: string }) => useReviewDetail(id),
      { wrapper: wrapperWith(client), initialProps: {} }
    )
    expect(fetchMock).not.toHaveBeenCalled()
    rerender({ id: "rev-1" })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reviews/rev-1")
  })
})
