"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchPresence } from "@/lib/api/presence"
import { queryKeys } from "./keys"

export function useAnalyticsPresence(params: { range: string; locationId?: string }) {
  return useQuery({
    queryKey: queryKeys.analytics("presence", params),
    queryFn: () => fetchPresence(params),
    staleTime: 30_000,
  })
}
