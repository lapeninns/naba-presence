"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchLocationActivity } from "@/lib/api/location-activity"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useLocationActivity(
  id: string,
  options: { page?: number; pageSize?: number; cursor?: string } = {}
) {
  const page = options.page ?? 1
  const pageSize = options.pageSize ?? 20
  return useQuery({
    queryKey: [...queryKeys.locationActivity(id, page), pageSize, options.cursor ?? null],
    queryFn: (ctx) => fetchLocationActivity(id, { page, pageSize, cursor: options.cursor }, requestOptions(ctx)),
  })
}
