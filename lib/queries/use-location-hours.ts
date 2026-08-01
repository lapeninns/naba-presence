"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchHours } from "@/lib/api/location-hours"
import { queryKeys } from "./keys"

export function useHours(id: string) {
  return useQuery({ queryKey: queryKeys.locationHours(id), queryFn: () => fetchHours(id), staleTime: 30_000 })
}
