import { QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  REVIEW_QUEUES,
  type ReviewDetail,
  type ReviewRow,
  type ReviewsPage,
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

function detail(workflowStatus: string, id = "rev-5"): ReviewDetail {
  return {
    review: {
      id,
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
function stubApi({
  snapshot,
  reviewId = "rev-5",
}: {
  snapshot: boolean
  reviewId?: string
}) {
  const requests: string[] = []
  const countsGate = { current: null as ReturnType<typeof deferred> | null }
  // Holds reads answered from before the write (see the version guard tests).
  const readGate = { current: null as ReturnType<typeof deferred> | null }
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost")
      const method = init?.method ?? "GET"
      requests.push(`${method} ${url.pathname}`)
      if (
        method === "POST" &&
        url.pathname === `/api/reviews/${reviewId}/publish`
      ) {
        return json({
          reviewReplyId: "rr-1",
          publishAttemptId: "pa-1",
          status: "published",
          googleReplyState: "APPROVED",
          ...(snapshot
            ? {
                row: row(reviewId, "published"),
                detail: detail("published", reviewId),
              }
            : {}),
        })
      }
      if (url.pathname === "/api/reviews/counts") {
        await countsGate.current?.promise
        return json(counts)
      }
      if (url.pathname === `/api/reviews/${reviewId}`) {
        const gate = readGate.current
        await gate?.promise
        return json(detail("verified", reviewId))
      }
      if (url.pathname === "/api/reviews") {
        await readGate.current?.promise
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
  return { requests, countsGate, readGate }
}

function renderInbox(reviewId = "rev-5") {
  const client = makeQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const view = renderHook(
    () => {
      const queries = {
        reviews: useReviews({}),
        detail: useReviewDetail(reviewId),
        counts: useReviewCounts(),
        clients: useClients(),
      }
      // Read during render: react-query re-renders only for the result
      // properties a render used, and the assertions below read these.
      for (const query of Object.values(queries)) {
        void [query.data, query.isSuccess, query.isFetching]
      }
      return { ...queries, publish: usePublishReview(reviewId) }
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

/**
 * A read already in flight when a write lands was answered from before the
 * write. Left alone it lands over the patch — a next-page fetch writes back
 * every page it started from — and the row flips back to its old status until
 * the next refetch. The write cancels those reads before patching.
 */
describe("a read in flight when a write is patched in", () => {
  const PUBLISH = {
    draftId: "d1",
    expectedReviewUpdateTime: "2026-09-01T00:00:00.000Z",
  }

  function statusOf(
    client: ReturnType<typeof renderInbox>["client"],
    reviewId: string
  ) {
    return {
      row: flattenReviews(
        client.getQueryData(queryKeys.reviews("organisation", {}))
      ).find((item) => item.id === reviewId)?.workflowStatus,
      detail: client.getQueryData<ReviewDetail>(
        queryKeys.reviewDetail(reviewId)
      )?.review.workflowStatus,
    }
  }

  it("does not let a list or detail refetch from before the write overwrite it", async () => {
    const api = stubApi({ snapshot: true })
    const { client, result } = renderInbox()
    await loadAllPages(result)

    api.readGate.current = deferred()
    let refetched: Promise<unknown> = Promise.resolve()
    act(() => {
      refetched = Promise.all([
        result.current.reviews.refetch(),
        result.current.detail.refetch(),
      ])
    })
    await waitFor(() => expect(result.current.reviews.isFetching).toBe(true))

    await act(async () => {
      await result.current.publish.mutateAsync(PUBLISH)
    })
    expect(statusOf(client, "rev-5")).toEqual({
      row: "published",
      detail: "published",
    })

    // The pre-write answers ("verified") arrive after the patch.
    await act(async () => {
      api.readGate.current?.resolve()
      await refetched
    })
    expect(statusOf(client, "rev-5")).toEqual({
      row: "published",
      detail: "published",
    })
    expect(result.current.reviews.data?.pages).toHaveLength(PAGES)
    // Still marked stale, so the next mount or focus reads it again.
    expect(
      client.getQueryState(queryKeys.reviews("organisation", {}))?.isInvalidated
    ).toBe(true)
  })

  it("does not let a next-page fetch write its older pages back over it", async () => {
    const api = stubApi({ snapshot: true, reviewId: "rev-3" })
    const { client, result } = renderInbox("rev-3")
    await waitFor(() => expect(result.current.reviews.isSuccess).toBe(true))
    await act(async () => {
      await result.current.reviews.fetchNextPage()
    })
    expect(statusOf(client, "rev-3").row).toBe("verified")

    api.readGate.current = deferred()
    let nextPage: Promise<unknown> = Promise.resolve()
    act(() => {
      nextPage = result.current.reviews.fetchNextPage()
    })
    await waitFor(() =>
      expect(result.current.reviews.isFetchingNextPage).toBe(true)
    )

    await act(async () => {
      await result.current.publish.mutateAsync(PUBLISH)
    })
    await act(async () => {
      api.readGate.current?.resolve()
      await nextPage
    })
    expect(statusOf(client, "rev-3").row).toBe("published")
  })

  it("leaves a list's first load alone: it has nothing to patch", async () => {
    const api = stubApi({ snapshot: true })
    const { client, result } = renderInbox()
    await loadAllPages(result)

    // Another list's first load (a filter just changed) is in flight.
    api.readGate.current = deferred()
    const otherKey = queryKeys.reviews("organisation", { queue: "needs_reply" })
    const firstLoad = client.prefetchInfiniteQuery({
      queryKey: otherKey,
      queryFn: async () =>
        (await fetch("/api/reviews")).json() as Promise<ReviewsPage>,
      initialPageParam: null as string | null,
    })
    await waitFor(() =>
      expect(client.getQueryState(otherKey)?.fetchStatus).toBe("fetching")
    )
    await act(async () => {
      await result.current.publish.mutateAsync(PUBLISH)
    })
    expect(client.getQueryState(otherKey)?.fetchStatus).toBe("fetching")
    await act(async () => {
      api.readGate.current?.resolve()
      await firstLoad
    })
    expect(client.getQueryState(otherKey)?.status).toBe("success")
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
