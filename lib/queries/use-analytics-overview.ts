"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchAnalyticsOverview } from "@/lib/api/analytics"
import { queryKeys } from "./keys"

export function useAnalyticsOverview(params?: {
  from?: string
  to?: string
  granularity?: "day" | "week" | "month"
}) {
  const keyParams = params ?? { window: "last-30-days" }
  return useQuery({
    queryKey: queryKeys.analytics("overview", keyParams),
    queryFn: () => fetchAnalyticsOverview(params),
    staleTime: 30_000,
  })
}
