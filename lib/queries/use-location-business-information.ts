"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchBusinessInformation, fetchBusinessInformationMetadata } from "@/lib/api/location-business-information"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

/**
 * `enabled` lets the profile editor hold this back until the NabaPresence copy
 * has arrived. Both routes call Google, and Google calls on one connection are
 * paced by the server's rate limiter, so firing them together makes the fields
 * an operator can actually edit wait on the ones they cannot.
 */
export function useBusinessInformation(id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.locationBusinessInformation(id),
    queryFn: (ctx) => fetchBusinessInformation(id, requestOptions(ctx)),
    enabled: options?.enabled ?? true,
  })
}

export function useBusinessInformationMetadata(id: string, type: "categories" | "chains", query: string) {
  return useQuery({
    queryKey: queryKeys.businessInformationMetadata(id, type, query),
    queryFn: (ctx) => fetchBusinessInformationMetadata(id, { type, query }, requestOptions(ctx)),
    enabled: query.trim().length > 0, // the route 400s on an empty query
  })
}
