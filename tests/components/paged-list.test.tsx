import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
} from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import { uniqueById, usePagedResource } from "@/lib/queries/paged-list"

type Page = { items: { id: string }[]; nextCursor: string | null }

function merge(pages: Page[]) {
  return { items: uniqueById(pages.flatMap((page) => page.items)) }
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function usePaged(fetchPage: (cursor: string | null) => Promise<Page>) {
  const query = useInfiniteQuery({
    queryKey: ["paged"],
    queryFn: (ctx) => fetchPage(ctx.pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
  return usePagedResource(query, merge)
}

describe("uniqueById", () => {
  it("keeps the first copy of a row that moved onto a later page", () => {
    expect(uniqueById([{ id: "a" }, { id: "b" }, { id: "a" }, { id: "c" }])).toEqual([
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ])
  })
})

describe("usePagedResource", () => {
  it("merges pages on Load more and stops when the last page says so", async () => {
    const fetchPage = vi.fn(async (cursor: string | null) =>
      cursor === null
        ? { items: [{ id: "a" }, { id: "b" }], nextCursor: "c1" }
        : { items: [{ id: "b" }, { id: "c" }], nextCursor: null }
    )
    const { result } = renderHook(() => usePaged(fetchPage), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.data?.items).toHaveLength(2))
    expect(result.current.data?.paging.hasMore).toBe(true)

    act(() => result.current.data?.paging.loadMore())
    await waitFor(() => expect(result.current.data?.paging.hasMore).toBe(false))
    expect(result.current.data?.items.map((item) => item.id)).toEqual(["a", "b", "c"])
    expect(fetchPage).toHaveBeenLastCalledWith("c1")
  })

  it("keeps the loaded rows when Load more fails, instead of failing the resource", async () => {
    const fetchPage = vi.fn(async (cursor: string | null) => {
      if (cursor) throw new Error("offline")
      return { items: [{ id: "a" }], nextCursor: "c1" }
    })
    const { result } = renderHook(() => usePaged(fetchPage), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.data?.items).toHaveLength(1))

    act(() => result.current.data?.paging.loadMore())
    await waitFor(() => expect(result.current.data?.paging.loadMoreFailed).toBe(true))
    expect(result.current.isError).toBe(false)
    expect(result.current.data?.items.map((item) => item.id)).toEqual(["a"])
    expect(result.current.data?.paging.hasMore).toBe(true)
  })

  it("fails the resource when the first page fails", async () => {
    const { result } = renderHook(
      () => usePaged(async () => { throw new Error("down") }),
      { wrapper: wrapper() }
    )
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })
})
