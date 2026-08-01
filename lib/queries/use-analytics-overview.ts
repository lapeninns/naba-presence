"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchAnalyticsOverview } from "@/lib/api/analytics"
import { queryKeys } from "./keys"

export function useAnalyticsOverview() {
  return useQuery({
    queryKey: queryKeys.analytics("overview", { window: "last-30-days" }),
    queryFn: () => fetchAnalyticsOverview(),
    staleTime: 30_000,
  })
}
