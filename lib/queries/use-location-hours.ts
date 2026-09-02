"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchHours } from "@/lib/api/location-hours"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useHours(id: string) {
  return useQuery({ queryKey: queryKeys.locationHours(id), queryFn: (ctx) => fetchHours(id, requestOptions(ctx)) })
}
