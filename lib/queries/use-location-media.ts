"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchMedia } from "@/lib/api/location-media"
import { queryKeys } from "./keys"

export function useMedia(id: string) {
  return useQuery({ queryKey: queryKeys.locationMedia(id), queryFn: () => fetchMedia(id), staleTime: 30_000 })
}
