"use client"

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"

import {
  fetchMedia,
  type MediaCategory,
  type MediaOwnership,
  type MediaState,
} from "@/lib/api/location-media"
import { DEFAULT_MEDIA_PAGE_SIZE } from "@/lib/media-page"
import { GOOGLE_LIVE_READ } from "./google-live"
import { queryKeys } from "./keys"
import { uniqueById, usePagedResource } from "./paged-list"
import { requestOptions } from "./request-options"

function mergeMedia(pages: MediaState[]): MediaState {
  // The first page is the one that may have re-read Google; its total, gates
  // and unresolved creates describe the whole library.
  const first = pages[0]
  return {
    ...first,
    items: uniqueById(pages.flatMap((page) => page.items)),
    nextCursor: pages.at(-1)?.nextCursor ?? null,
  }
}

/** One filter set of the location's photo library, a keyset page at a time. */
export function useMedia(
  id: string,
  options: {
    pageSize?: number
    category?: MediaCategory | null
    ownership?: MediaOwnership | null
  } = {}
) {
  const pageSize = options.pageSize ?? DEFAULT_MEDIA_PAGE_SIZE
  const category = options.category ?? null
  const ownership = options.ownership ?? null
  const query = useInfiniteQuery({
    queryKey: queryKeys.locationMedia(id, { category, ownership }),
    queryFn: (ctx) =>
      fetchMedia(
        id,
        {
          pageSize,
          cursor: ctx.pageParam ?? undefined,
          category: category ?? undefined,
          ownership: ownership ?? undefined,
        },
        requestOptions(ctx)
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    // Filtering keeps the current grid on screen while the next set loads,
    // instead of dropping back to a skeleton.
    placeholderData: keepPreviousData,
    // The first page reconciles with Google.
    ...GOOGLE_LIVE_READ,
  })
  return usePagedResource(query, mergeMedia)
}
