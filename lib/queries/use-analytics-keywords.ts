"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchKeywords } from "@/lib/api/keywords"
import { queryKeys } from "./keys"

export function useAnalyticsKeywords(params: { range: string; locationId?: string }) {
  return useQuery({
    queryKey: queryKeys.analytics("keywords", params),
    queryFn: () => fetchKeywords(params),
    staleTime: 30_000,
  })
}
