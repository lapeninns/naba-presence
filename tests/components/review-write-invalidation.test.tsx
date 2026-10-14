import { QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  REVIEW_QUEUES,
  type ReviewDetail,
  type ReviewRow,
} from "@/lib/contracts/reviews"
import { invalidateReviewBatch } from "@/lib/queries/invalidate"
import { queryKeys } from "@/lib/queries/keys"
import { makeQueryClient } from "@/lib/queries/query-client"
import { useClients } from "@/lib/queries/use-clients"
import { usePublishReview } from "@/lib/queries/use-publish-review"
import { useReviewCounts } from "@/lib/queries/use-review-counts"
import { useReviewDetail } from "@/lib/queries/use-review-detail"
import { flattenReviews, useReviews } from "@/lib/queries/use-reviews"

/**
 * W1-F2 / WP-09: a review write used to await a refetch of the detail, then
 * EVERY loaded list page in sequence, then the counts — K + 2 reads holding
 * "Publishing…" after K pages. The write now answers with the row and detail,
 * which are patched in; only counts and the clients' badges refetch, in the
 * background.
 */

const PAGES = 3
const PAGE_SIZE = 2

function row(id: string, workflowStatus = "verified"): ReviewRow {
  return {
    id,
    location: {
      id: "loc-1",
      name: "Riverside",
      clientId: null,
      clientName: null,
    },
    reviewer: { displayName: "Sam", isAnonymous: false, profilePhotoUrl: null },
    rating: 5,
    text: "Lovely.",
    detectedLanguageCode: "en",
    languageConfidence: 0.9,
    createTime: "2026-09-01T00:00:00.000Z",
    updateTime: "2026-09-01T00:00:00.000Z",
    hasMedia: false,
    workflowStatus,
    draftId: "d1",
    draftBody: "Thank you.",
    verificationStatus: "pass",
    replyStatus: null,
    googleReplyState: null,
    googlePolicyViolation: null,
    replyBody: null,
    syncStatus: null,
    capabilities: {
      canPublish: true,
      canEdit: true,
      canRequestApproval: false,
    },
  }
}

function detail(workflowStatus: string): ReviewDetail {
  return {
    review: {
      id: "rev-5",
      reviewerDisplayName: "Sam",
      reviewerIsAnonymous: false,
      reviewerProfilePhotoUrl: null,
      rating: 5,
      text: "Lovely.",
      detectedLanguageCode: "en",
      languageConfidence: 0.9,
      createTime: "2026-09-01T00:00:00.000Z",
      updateTime: "2026-09-01T00:00:00.000Z",
      hasMedia: false,
      workflowStatus,
      locationId: "loc-1",
      locationName: "Riverside",
      timezone: "Europe/London",
      verified: true,
      media: [],
      drafts: [],
      reply: null,
      timeline: [],
      capabilities: {
        canPublish: true,
        canEdit: true,
        canRequestApproval: false,
      },
      latestVerification: null,
    },
  }
}

const counts = {
  total: 6,
  byStatus: { verified: 6 },
  byQueue: Object.fromEntries(REVIEW_QUEUES.map((queue) => [queue, 0])),
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

/**
 * The API as the inbox reaches it, counting every request by path. Pages are
 * served by cursor; the publish answers with or without its snapshot.
 */
function stubApi({ snapshot }: { snapshot: boolean }) {
  const requests: string[] = []
  const countsGate = { current: null as ReturnType<typeof deferred> | null }
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost")
      const method = init?.method ?? "GET"
      requests.push(`${method} ${url.pathname}`)
      if (method === "POST" && url.pathname === "/api/reviews/rev-5/publish") {
        return json({
          reviewReplyId: "rr-1",
          publishAttemptId: "pa-1",
          status: "published",
          googleReplyState: "APPROVED",
          ...(snapshot
            ? { row: row("rev-5", "published"), detail: detail("published") }
            : {}),
        })
      }
      if (url.pathname === "/api/reviews/counts") {
        await countsGate.current?.promise
        return json(counts)
      }
      if (url.pathname === "/api/reviews/rev-5") {
        return json(detail("verified"))
      }
      if (url.pathname === "/api/reviews") {
        const page = Number(url.searchParams.get("cursor") ?? "0")
        return json({
          items: Array.from({ length: PAGE_SIZE }, (_, index) =>
            row(`rev-${page * PAGE_SIZE + index + 1}`)
          ),
          nextCursor: page + 1 < PAGES ? String(page + 1) : null,
        })
      }
      if (url.pathname === "/api/clients") {
        return json({ items: [], unassignedLocationCount: 0 })
      }
      throw new Error(`unexpected request ${method} ${url.pathname}`)
    }
  )
  vi.stubGlobal("fetch", fetchMock)
  return { requests, countsGate }
}

function renderInbox() {
  const client = makeQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const view = renderHook(
    () => {
      const queries = {
        reviews: useReviews({}),
        detail: useReviewDetail("rev-5"),
        counts: useReviewCounts(),
        clients: useClients(),
      }
      // Read during render: react-query re-renders only for the result
      // properties a render used, and the assertions below read these.
      for (const query of Object.values(queries)) {
        void [query.data, query.isSuccess, query.isFetching]
      }
      return { ...queries, publish: usePublishReview("rev-5") }
    },
    { wrapper }
  )
  return { client, ...view }
}

async function loadAllPages(result: ReturnType<typeof renderInbox>["result"]) {
  await waitFor(() => {
    expect(result.current.reviews.isSuccess).toBe(true)
    expect(result.current.detail.isSuccess).toBe(true)
    expect(result.current.counts.isSuccess).toBe(true)
    expect(result.current.clients.isSuccess).toBe(true)
  })
  for (let page = 1; page < PAGES; page += 1) {
    await act(async () => {
      await result.current.reviews.fetchNextPage()
    })
  }
  await waitFor(() =>
    expect(result.current.reviews.data?.pages).toHaveLength(PAGES)
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("a review write's follow-up requests", () => {
  it(`patches a publish in with at most 2 follow-up reads, not ${PAGES} pages + 2`, async () => {
    const api = stubApi({ snapshot: true })
    const { client, result } = renderInbox()
    await loadAllPages(result)
    api.requests.length = 0
    // Hold the counts answer: the publish must not wait on it.
    api.countsGate.current = deferred()

    await act(async () => {
      await result.current.publish.mutateAsync({
        draftId: "d1",
        expectedReviewUpdateTime: "2026-09-01T00:00:00.000Z",
      })
    })
    // Resolved while the counts read is still outstanding.
    expect(
      client.getQueryState(queryKeys.reviewCounts("organisation"))?.fetchStatus
    ).toBe("fetching")

    // The row moved in place in its page, and the pane holds the new state.
    const rows = flattenReviews(
      client.getQueryData(queryKeys.reviews("organisation", {}))
    )
    expect(rows.map((item) => item.id)).toEqual([
      "rev-1",
      "rev-2",
      "rev-3",
      "rev-4",
      "rev-5",
      "rev-6",
    ])
    expect(rows.find((item) => item.id === "rev-5")?.workflowStatus).toBe(
      "published"
    )
    expect(
      client.getQueryData<ReviewDetail>(queryKeys.reviewDetail("rev-5"))?.review
        .workflowStatus
    ).toBe("published")

    await act(async () => {
      api.countsGate.current?.resolve()
    })
    await waitFor(() => {
      expect(result.current.counts.isFetching).toBe(false)
      expect(result.current.clients.isFetching).toBe(false)
    })
    const followUps = api.requests.filter(
      (request) => !request.startsWith("POST")
    )
    expect(
      followUps.filter((request) => request === "GET /api/reviews")
    ).toEqual([])
    expect(followUps).not.toContain("GET /api/reviews/rev-5")
    expect(followUps.length).toBeLessThanOrEqual(2)
    expect([...followUps].sort()).toEqual([
      "GET /api/clients",
      "GET /api/reviews/counts",
    ])
  })

  it("marks the lists stale so the next mount or focus reconciles membership", async () => {
    stubApi({ snapshot: true })
    const { client, result } = renderInbox()
    await loadAllPages(result)
    await act(async () => {
      await result.current.publish.mutateAsync({
        draftId: "d1",
        expectedReviewUpdateTime: "2026-09-01T00:00:00.000Z",
      })
    })
    expect(
      client.getQueryState(queryKeys.reviews("organisation", {}))?.isInvalidated
    ).toBe(true)
  })

  it("re-reads only the detail, and waits for it, when the response has no snapshot", async () => {
    const api = stubApi({ snapshot: false })
    const { result } = renderInbox()
    await loadAllPages(result)
    api.requests.length = 0

    await act(async () => {
      await result.current.publish.mutateAsync({
        draftId: "d1",
        expectedReviewUpdateTime: "2026-09-01T00:00:00.000Z",
      })
    })
    expect(api.requests).toContain("GET /api/reviews/rev-5")
    expect(api.requests).not.toContain("GET /api/reviews")
  })
})

describe("invalidateReviewBatch", () => {
  it("reaches lists, counts, clients and each touched review's detail", () => {
    const client = makeQueryClient()
    const spy = vi.spyOn(client, "invalidateQueries")
    invalidateReviewBatch(client, ["rev-1", "rev-2"])
    expect(spy.mock.calls.map((call) => call[0]?.queryKey)).toEqual([
      queryKeys.reviewsAll,
      queryKeys.reviewCountsAll,
      queryKeys.clientsAll,
      queryKeys.reviewDetail("rev-1"),
      queryKeys.reviewDetail("rev-2"),
    ])
  })
})
