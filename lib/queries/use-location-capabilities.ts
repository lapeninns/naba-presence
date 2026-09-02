"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchLocationCapabilities } from "@/lib/api/locations"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useLocationCapabilities(id: string) {
  return useQuery({
    queryKey: queryKeys.locationCapabilities(id),
    queryFn: (ctx) => fetchLocationCapabilities(id, requestOptions(ctx)),
  })
}
