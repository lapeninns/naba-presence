"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchBusinessInformation, fetchBusinessInformationMetadata } from "@/lib/api/location-business-information"
import { queryKeys } from "./keys"

export function useBusinessInformation(id: string) {
  return useQuery({ queryKey: queryKeys.locationBusinessInformation(id), queryFn: () => fetchBusinessInformation(id), staleTime: 30_000 })
}

export function useBusinessInformationMetadata(id: string, type: "categories" | "chains", query: string) {
  return useQuery({
    queryKey: queryKeys.businessInformationMetadata(id, type, query),
    queryFn: () => fetchBusinessInformationMetadata(id, { type, query }),
    enabled: query.trim().length > 0, // the route 400s on an empty query
    staleTime: 30_000,
  })
}
