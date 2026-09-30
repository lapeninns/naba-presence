"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchAdministration } from "@/lib/api/location-administration"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useAdministration(
  id: string,
  { enabled = true }: { enabled?: boolean } = {}
) {
  return useQuery({
    enabled,
    queryKey: queryKeys.locationAdministration(id),
    queryFn: (ctx) => fetchAdministration(id, requestOptions(ctx)),
  })
}
