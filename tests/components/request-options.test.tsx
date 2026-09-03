import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useInvalidateReviewWrites } from "@/lib/queries/invalidate"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { useReviewCounts } from "@/lib/queries/use-review-counts"
import { useReviews } from "@/lib/queries/use-reviews"

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}
const unauthorized = () =>
  jsonResponse(401, { error: "authentication_required", message: "Sign in." })

function wrapperWith(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}
function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}
function stubLocation() {
  const assign = vi.fn()
  vi.stubGlobal("location", {
    ...window.location,
    pathname: "/inbox",
    search: "",
    assign,
  })
  return assign
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const counts = {
  total: 1,
  byStatus: { new: 1, escalated: 0, failed: 0, published: 0 },
  byQueue: { needs_reply: 0, awaiting_my_approval: 0, awaiting_others: 0, publishing: 0, failed: 0, done: 0, all: 0 },
}

describe("requestOptions", () => {
  it("forwards the query's abort signal", () => {
    const client = newClient()
    const controller = new AbortController()
    const options = requestOptions({
      client,
      queryKey: queryKeys.session,
      signal: controller.signal,
    })
    expect(options.signal).toBe(controller.signal)
  })

  it("is foreground when the query holds no data yet", () => {
    const client = newClient()
    const options = requestOptions({
      client,
      queryKey: queryKeys.session,
      signal: new AbortController().signal,
    })
    expect(options.background).toBe(false)
  })

  it("is background when the query already holds data (a refetch)", () => {
    const client = newClient()
    client.setQueryData(queryKeys.session, { session: null })
    const options = requestOptions({
      client,
      queryKey: queryKeys.session,
      signal: new AbortController().signal,
    })
    expect(options.background).toBe(true)
  })
})

describe("query hooks forward abort + background to apiFetch", () => {
  it("useReviewCounts passes React Query's signal to fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(200, counts))
    vi.stubGlobal("fetch", fetchMock)
    const client = newClient()
    const { result } = renderHook(() => useReviewCounts(), {
      wrapper: wrapperWith(client),
    })
    await waitFor(() => expect(result.current.data).toBeDefined())
    const [, init] = fetchMock.mock.calls[0]
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it("useReviews passes the signal on every page request", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(200, { items: [], nextCursor: null })
    )
    vi.stubGlobal("fetch", fetchMock)
    const client = newClient()
    const { result } = renderHook(() => useReviews({}), {
      wrapper: wrapperWith(client),
    })
    await waitFor(() => expect(result.current.data).toBeDefined())
    const [, init] = fetchMock.mock.calls[0]
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it("a superseded filter key aborts the previous request", async () => {
    const seen: AbortSignal[] = []
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      seen.push(init!.signal!)
      await new Promise((resolve) => setTimeout(resolve, 20))
      return jsonResponse(200, { items: [], nextCursor: null })
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = newClient()
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useReviews({ search: q }),
      { wrapper: wrapperWith(client), initialProps: { q: "a" } }
    )
    await waitFor(() => expect(seen).toHaveLength(1))
    rerender({ q: "ab" })
    await waitFor(() => expect(seen).toHaveLength(2))
    await waitFor(() => expect(result.current.data).toBeDefined())
    // React Query drops the observer on the "a" key; once it is garbage
    // collected its signal is aborted. Force that here rather than waiting
    // for gcTime, and prove the abort reaches the fetch we issued.
    act(() => {
      client.removeQueries({ queryKey: queryKeys.reviews("organisation", { search: "a" }) })
    })
    await waitFor(() => expect(seen[0].aborted).toBe(true))
    expect(seen[1]).not.toBe(seen[0])
  })

  it("an initial-load 401 redirects to sign-in (foreground)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => unauthorized()))
    const assign = stubLocation()
    const client = newClient()
    const { result } = renderHook(() => useReviewCounts(), {
      wrapper: wrapperWith(client),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(assign).toHaveBeenCalledWith(
      "/sign-in?next=" + encodeURIComponent("/inbox")
    )
  })

  it("a refetch 401 on a query that already has data does not navigate", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => unauthorized()))
    const assign = stubLocation()
    const client = newClient()
    client.setQueryData(queryKeys.reviewCounts("organisation"), counts)
    const { result } = renderHook(() => useReviewCounts(), {
      wrapper: wrapperWith(client),
    })
    // Mounting an observer over cached-but-stale data is exactly what a
    // window-focus / interval refetch does: a fetch with data on screen.
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toEqual(counts)
    expect(assign).not.toHaveBeenCalled()
  })
})

describe("useInvalidateReviewWrites", () => {
  it("drops the detail, every review list and every counts scope", () => {
    const client = newClient()
    const spy = vi.spyOn(client, "invalidateQueries")
    const { result } = renderHook(() => useInvalidateReviewWrites("rev-1"), {
      wrapper: wrapperWith(client),
    })
    result.current()
    const keys = spy.mock.calls.map((call) => call[0]?.queryKey)
    expect(keys).toEqual([
      queryKeys.reviewDetail("rev-1"),
      queryKeys.reviewsAll,
      queryKeys.reviewCountsAll,
    ])
  })

  it("prefix invalidation reaches scoped list and count keys", async () => {
    const client = newClient()
    client.setQueryData(queryKeys.reviews("organisation", { q: "x" }), { pages: [], pageParams: [] })
    client.setQueryData(queryKeys.reviewCounts("loc-1"), counts)
    client.setQueryData(queryKeys.reviewDetail("rev-9"), { id: "rev-9" })
    const { result } = renderHook(() => useInvalidateReviewWrites("rev-1"), {
      wrapper: wrapperWith(client),
    })
    result.current()
    await waitFor(() => {
      expect(client.getQueryState(queryKeys.reviews("organisation", { q: "x" }))?.isInvalidated).toBe(true)
      expect(client.getQueryState(queryKeys.reviewCounts("loc-1"))?.isInvalidated).toBe(true)
    })
    // Another review's detail is untouched.
    expect(client.getQueryState(queryKeys.reviewDetail("rev-9"))?.isInvalidated).toBe(false)
  })
})
