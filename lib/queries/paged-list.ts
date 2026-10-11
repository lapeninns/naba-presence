"use client"

import type {
  InfiniteData,
  UseInfiniteQueryResult,
} from "@tanstack/react-query"
import { useMemo } from "react"

/**
 * "Load more" state for a keyset-paged list, as the list's footer reads it
 * (components/ui/load-more.tsx).
 */
export type ListPaging = {
  /** The last page loaded said another one follows. */
  hasMore: boolean
  loadingMore: boolean
  /** The last "load more" failed; the rows already loaded stay. */
  loadMoreFailed: boolean
  loadMore: () => void
}

/**
 * The first copy of each id, in order. A row edited between two page reads
 * can move above the cursor and come back on a later page; it is shown once,
 * where it was first loaded.
 */
export function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

/**
 * An infinite query as one resource for the location tab shell: `data` is
 * the pages merged by `merge` plus their `paging`. A failed "load more" is
 * not a failed resource: it keeps the loaded rows on screen and reports
 * through `paging.loadMoreFailed` instead of swapping the tab for an error.
 *
 * `merge` must be a stable (module-level) function.
 */
export function usePagedResource<Page, T>(
  query: UseInfiniteQueryResult<InfiniteData<Page>, Error>,
  merge: (pages: Page[]) => T
): {
  data: (T & { paging: ListPaging }) | undefined
  isPending: boolean
  isError: boolean
  error: Error | null
  refetch: () => unknown
} {
  const {
    data: infinite,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = query
  const data = useMemo(
    () =>
      infinite
        ? {
            ...merge(infinite.pages),
            paging: {
              hasMore: hasNextPage,
              loadingMore: isFetchingNextPage,
              loadMoreFailed: isFetchNextPageError,
              loadMore: () => {
                if (!isFetchingNextPage) void fetchNextPage()
              },
            },
          }
        : undefined,
    [
      infinite,
      merge,
      hasNextPage,
      isFetchingNextPage,
      isFetchNextPageError,
      fetchNextPage,
    ]
  )
  return {
    data,
    isPending: query.isPending,
    isError: query.isError && !(isFetchNextPageError && infinite),
    error: query.error,
    refetch: query.refetch,
  }
}
