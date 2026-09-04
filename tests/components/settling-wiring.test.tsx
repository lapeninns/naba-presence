import { QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SETTLING_POLL_MS } from "@/lib/inbox/settling"
import { makeQueryClient } from "@/lib/queries/query-client"
import { useReviewDetail } from "@/lib/queries/use-review-detail"

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

const DETAIL = (workflowStatus: string) => ({
  review: {
    id: "r1",
    reviewerDisplayName: "A. Visitor",
    reviewerIsAnonymous: false,
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: "Great pub.",
    detectedLanguageCode: "en",
    languageConfidence: 0.99,
    createTime: "2026-09-01T00:00:00.000Z",
    updateTime: "2026-09-01T00:00:00.000Z",
    hasMedia: false,
    workflowStatus,
    locationId: "loc-1",
    locationName: "Old Crown",
    timezone: "Europe/London",
    verified: true,
    media: [],
    drafts: [],
    reply: null,
    timeline: [],
    capabilities: { canPublish: true, canEdit: true, canRequestApproval: true },
    latestVerification: null,
  },
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/**
 * The interval the hook actually handed react-query, resolved against state.
 *
 * `refetchInterval` is an observer option rather than a query option, so it is
 * read off the query's own options bag, which the cache types loosely.
 */
function resolvedInterval(client: ReturnType<typeof makeQueryClient>) {
  const query = client.getQueryCache().getAll()[0]
  const option = (
    query?.options as {
      refetchInterval?: number | false | ((query: unknown) => number | false)
    } | undefined
  )?.refetchInterval
  return typeof option === "function" ? option(query) : option
}

describe("the review detail query", () => {
  it("polls while the reply is still on its way to Google", async () => {
    // The wiring, not the rule: a correct settling.ts that nobody passed to
    // refetchInterval leaves the pane exactly as stuck as before.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(DETAIL("publish_requested")))
    )
    const client = makeQueryClient()
    const { result } = renderHook(() => useReviewDetail("r1"), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(resolvedInterval(client)).toBe(SETTLING_POLL_MS)
  })

  it("stops polling once Google has answered", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(DETAIL("published")))
    )
    const client = makeQueryClient()
    const { result } = renderHook(() => useReviewDetail("r1"), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(resolvedInterval(client)).toBe(false)
  })
})
