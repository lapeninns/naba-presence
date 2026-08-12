"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchLocationActivity } from "@/lib/api/location-activity"
import { queryKeys } from "./keys"

export function useLocationActivity(
  id: string,
  options: { page?: number; pageSize?: number } = {}
) {
  const page = options.page ?? 1
  const pageSize = options.pageSize ?? 20
  return useQuery({
    queryKey: queryKeys.locationActivity(id, page),
    queryFn: () => fetchLocationActivity(id, { page, pageSize }),
    staleTime: 30_000,
  })
}
