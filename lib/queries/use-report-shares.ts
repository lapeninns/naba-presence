"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchReportShares } from "@/lib/api/report-shares"

import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

/** A client's report share links; fetched only while `enabled`. */
export function useReportShares(clientId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.clientReportShares(clientId),
    queryFn: (ctx) => fetchReportShares(clientId, requestOptions(ctx)),
    enabled,
  })
}
