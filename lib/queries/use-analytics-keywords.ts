"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchKeywords } from "@/lib/api/keywords"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useAnalyticsKeywords(params: { range: string; locationId?: string }) {
  return useQuery({
    queryKey: queryKeys.analytics("keywords", params),
    queryFn: (ctx) => fetchKeywords(params, requestOptions(ctx)),
  })
}
