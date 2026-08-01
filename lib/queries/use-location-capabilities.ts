"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchLocationCapabilities } from "@/lib/api/locations"
import { queryKeys } from "./keys"

export function useLocationCapabilities(id: string) {
  return useQuery({
    queryKey: queryKeys.locationCapabilities(id),
    queryFn: () => fetchLocationCapabilities(id),
    staleTime: 30_000,
  })
}
