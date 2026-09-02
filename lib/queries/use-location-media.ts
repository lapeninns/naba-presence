"use client"

import { useQuery } from "@tanstack/react-query"

import {
  fetchMedia,
  type MediaCategory,
  type MediaOwnership,
} from "@/lib/api/location-media"
import { DEFAULT_MEDIA_PAGE_SIZE } from "@/lib/media-page"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useMedia(
  id: string,
  options: {
    page?: number
    pageSize?: number
    category?: MediaCategory | null
    ownership?: MediaOwnership | null
  } = {}
) {
  const page = options.page ?? 1
  const pageSize = options.pageSize ?? DEFAULT_MEDIA_PAGE_SIZE
  const category = options.category ?? null
  const ownership = options.ownership ?? null
  return useQuery({
    queryKey: queryKeys.locationMedia(id, { page, category, ownership }),
    queryFn: (ctx) =>
      fetchMedia(
        id,
        {
          page,
          pageSize,
          category: category ?? undefined,
          ownership: ownership ?? undefined,
        },
        requestOptions(ctx)
      ),
  })
}
