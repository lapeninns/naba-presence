import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import { useInvalidateReviewWrites } from "@/lib/queries/invalidate"
import { queryKeys } from "@/lib/queries/keys"

function deferred() {
  let resolve: (() => void) | undefined
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })

  return {
    promise,
    resolve: () => resolve?.(),
  }
}

function wrapperFor(client: QueryClient) {
  return function QueryClientTestWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe("review write invalidation", () => {
  it("waits for the refreshed review state before resolving", async () => {
    const client = new QueryClient()
    const gate = deferred()
    const invalidatedKeys: Array<readonly unknown[]> = []

    vi.spyOn(client, "invalidateQueries").mockImplementation(async (filters) => {
      if (!filters) {
        throw new Error("invalidateQueries filters missing")
      }
      invalidatedKeys.push(filters.queryKey ?? [])
      await gate.promise
    })

    const { result } = renderHook(() => useInvalidateReviewWrites("review-1"), {
      wrapper: wrapperFor(client),
    })

    let settled = false
    let completion: Promise<void> | undefined

    await act(async () => {
      completion = result.current()
      completion?.then(() => {
        settled = true
      })
      await Promise.resolve()
    })

    expect(completion).toBeInstanceOf(Promise)
    expect(settled).toBe(false)
    expect(invalidatedKeys).toEqual([
      queryKeys.reviewDetail("review-1"),
      queryKeys.reviewsAll,
      queryKeys.reviewCountsAll,
    ])

    await act(async () => {
      gate.resolve()
      await completion
    })

    expect(settled).toBe(true)
  })
})
