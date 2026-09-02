"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchGoogleLocations } from "@/lib/api/google-locations"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useGoogleLocations(accountName: string | null) {
  return useQuery({
    queryKey: queryKeys.googleLocations(accountName),
    queryFn: (ctx) => fetchGoogleLocations(accountName, requestOptions(ctx)),
    enabled: accountName !== null,
  })
}
