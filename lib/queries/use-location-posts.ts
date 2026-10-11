"use client"

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"

import { fetchPosts, type PostsState } from "@/lib/api/location-posts"
import type { PostListFilter } from "@/lib/contracts/location-posts"
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
  })
  return usePagedResource(query, mergePosts)
}
