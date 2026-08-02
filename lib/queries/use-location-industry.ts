"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchIndustry } from "@/lib/api/location-industry"
import { queryKeys } from "./keys"

export function useIndustry(id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.locationIndustry(id),
    queryFn: () => fetchIndustry(id),
    enabled: options?.enabled ?? true, // D4: pass canEditCanonical so a non-owner never fires the 403 GET
    staleTime: 30_000,
  })
}
