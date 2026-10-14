"use client"

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"

import { fetchPosts, type PostsState } from "@/lib/api/location-posts"
import type { PostListFilter } from "@/lib/contracts/location-posts"
import { GOOGLE_LIVE_READ } from "./google-live"
import { queryKeys } from "./keys"
import { uniqueById, usePagedResource } from "./paged-list"
import { requestOptions } from "./request-options"

function mergePosts(pages: PostsState[]) {
  // The first page is the one that reconciled with Google; its counts,
  // timezone and reconciliation result describe the whole list.
  const first = pages[0]
  return {
    posts: uniqueById(pages.flatMap((page) => page.posts)),
    counts: first.counts,
    filter: first.filter,
    timezone: first.timezone,
    writesEnabled: first.writesEnabled,
    reconciliationError: first.reconciliationError,
    // When the first page's rows were last reconciled with Google.
    ...(first.observedAt ? { observedAt: first.observedAt } : {}),
  }
}

export type PostsView = ReturnType<typeof mergePosts>

/** One status view of the location's posts, a keyset page at a time. */
export function usePosts(id: string, filter: PostListFilter = "all") {
  const query = useInfiniteQuery({
    queryKey: queryKeys.locationPostsView(id, filter),
    queryFn: (ctx) =>
      fetchPosts(
        id,
        { filter, cursor: ctx.pageParam ?? undefined },
        requestOptions(ctx)
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    // Switching view keeps the current list on screen while the next loads,
    // instead of dropping the whole tab back to a skeleton.
    placeholderData: keepPreviousData,
    // The first page reconciles with Google.
    ...GOOGLE_LIVE_READ,
  })
  return usePagedResource(query, mergePosts)
}

/**
 * "Check Google now": reconciles the posts with Google past the staleness
 * budget, then reloads every view from the rows it wrote. Google being
 * unreachable fails the check (the list itself still answers).
 */
export function useRefreshPosts(id: string, filter: PostListFilter = "all") {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const page = await fetchPosts(id, { filter, refresh: "1" })
      if (page.reconciliationError) throw new Error(page.reconciliationError)
      return page
    },
    onSettled: () =>
      client.invalidateQueries({ queryKey: queryKeys.locationPosts(id) }),
  })
}
