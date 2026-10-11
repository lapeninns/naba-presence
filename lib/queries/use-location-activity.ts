"use client"

import { useInfiniteQuery, useQuery } from "@tanstack/react-query"

import {
  fetchLocationActivity,
  type LocationActivityState,
} from "@/lib/api/location-activity"
import { queryKeys } from "./keys"
import { uniqueById, usePagedResource } from "./paged-list"
import { requestOptions } from "./request-options"

/** The newest `pageSize` changes only: the glance on the listing overview. */
export function useLocationActivity(
  id: string,
  options: { pageSize?: number } = {}
) {
  const pageSize = options.pageSize ?? 20
  return useQuery({
    queryKey: queryKeys.locationActivityRecent(id, pageSize),
    queryFn: (ctx) =>
      fetchLocationActivity(id, { pageSize }, requestOptions(ctx)),
  })
}

function mergeActivity(pages: LocationActivityState[]) {
  const first = pages[0]
  return {
    canManage: first?.canManage,
    total: first?.total ?? 0,
    pageSize: first?.pageSize ?? 0,
    items: uniqueById(pages.flatMap((page) => page.items)),
  }
}

/** The whole history, a keyset page at a time ("Load more"). */
export function useLocationActivityPages(id: string, pageSize: number) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.locationActivityPages(id, pageSize),
    queryFn: (ctx) =>
      fetchLocationActivity(
        id,
        { pageSize, cursor: ctx.pageParam ?? undefined },
        requestOptions(ctx)
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })
  return usePagedResource(query, mergeActivity)
}
