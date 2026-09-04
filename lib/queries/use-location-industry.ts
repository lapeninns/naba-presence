"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchIndustry } from "@/lib/api/location-industry"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

/** See the note on `useBusinessInformation`: this one fans out furthest. */
export function useIndustry(id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.locationIndustry(id),
    queryFn: (ctx) => fetchIndustry(id, requestOptions(ctx)),
    enabled: options?.enabled ?? true,
  })
}
