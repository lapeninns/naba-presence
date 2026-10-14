import { QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiClientError } from "@/lib/api/client"
import { makeQueryClient, shouldRetryQuery } from "@/lib/queries/query-client"
import { useReviewDetail } from "@/lib/queries/use-review-detail"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// W1-F4: `retry: 1` re-sent every failed read, so a deleted review or a
// hidden location showed its error a second late and reported the lost
// access twice.
describe("the query retry policy", () => {
  it("is the client's default", () => {
    expect(makeQueryClient().getDefaultOptions().queries?.retry).toBe(
      shouldRetryQuery
    )
  })

  it.each([400, 403, 404, 409, 422])("does not retry a %s", (status) => {
    expect(shouldRetryQuery(0, new ApiClientError(status, "x", "x"))).toBe(
      false
    )
  })

  it.each([408, 429, 500, 502, 503])("retries a %s once", (status) => {
    const error = new ApiClientError(status, "x", "x")
    expect(shouldRetryQuery(0, error)).toBe(true)
    expect(shouldRetryQuery(1, error)).toBe(false)
  })

  it("retries a dropped connection once", () => {
    expect(shouldRetryQuery(0, new TypeError("Failed to fetch"))).toBe(true)
    expect(shouldRetryQuery(1, new TypeError("Failed to fetch"))).toBe(false)
  })

  it("sends a 404 read exactly once", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: "review_not_found", message: "Not found." }),
          { status: 404, headers: { "content-type": "application/json" } }
        )
    )
    vi.stubGlobal("fetch", fetchMock)
    const client = makeQueryClient()
    const { result } = renderHook(() => useReviewDetail("gone"), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
