"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchProfile } from "@/lib/api/location-profile"
import { queryKeys } from "./keys"

export function useProfile(id: string) {
  return useQuery({ queryKey: queryKeys.locationProfile(id), queryFn: () => fetchProfile(id), staleTime: 30_000 })
}
