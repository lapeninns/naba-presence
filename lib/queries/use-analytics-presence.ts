"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchPresence } from "@/lib/api/presence"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useAnalyticsPresence(params: { range: string; locationId?: string; clientId?: string }) {
  return useQuery({
    queryKey: queryKeys.analytics("presence", params),
    queryFn: (ctx) => fetchPresence(params, requestOptions(ctx)),
  })
}
