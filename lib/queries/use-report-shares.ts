"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchReportShares } from "@/lib/api/report-shares"

import { queryKeys } from "./keys"

/** A client's report share links; fetched only while `enabled`. */
export function useReportShares(clientId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.clientReportShares(clientId),
    queryFn: ({ signal }) => fetchReportShares(clientId, signal),
    enabled,
  })
}
