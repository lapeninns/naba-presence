"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchGoogleLocations } from "@/lib/api/google-locations"
import { queryKeys } from "./keys"

export function useGoogleLocations(accountName: string | null) {
  return useQuery({
    queryKey: queryKeys.googleLocations(accountName),
    queryFn: () => fetchGoogleLocations(accountName),
    enabled: accountName !== null,
    staleTime: 30_000,
  })
}
