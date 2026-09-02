"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchIndustry } from "@/lib/api/location-industry"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useIndustry(id: string) {
  return useQuery({
    queryKey: queryKeys.locationIndustry(id),
    queryFn: (ctx) => fetchIndustry(id, requestOptions(ctx)),
  })
}
