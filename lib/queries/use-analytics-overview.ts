"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchAnalyticsOverview } from "@/lib/api/analytics"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useAnalyticsOverview(params?: {
  from?: string
  to?: string
  granularity?: "day" | "week" | "month"
}) {
  const keyParams = params ?? { window: "last-30-days" }
  return useQuery({
    queryKey: queryKeys.analytics("overview", keyParams),
    queryFn: (ctx) => fetchAnalyticsOverview(params, requestOptions(ctx)),
  })
}
