"use client"

import { useQuery } from "@tanstack/react-query"

import {
  fetchListingSummaries,
  fetchListingSummary,
} from "@/lib/api/location-summary"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

/** One listing's state: cheap, DB-only, refreshed after every publish. */
export function useListingSummary(id: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.listingSummary(id ?? "none"),
    queryFn: (ctx) => fetchListingSummary(id!, requestOptions(ctx)),
    enabled: Boolean(id),
    staleTime: 30_000,
  })
}

/** Every visible listing's state, for the board. */
export function useListingSummaries() {
  return useQuery({
    queryKey: queryKeys.listingSummaries,
    queryFn: (ctx) => fetchListingSummaries(requestOptions(ctx)),
    staleTime: 30_000,
  })
}
