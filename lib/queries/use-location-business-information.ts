"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchBusinessInformation, fetchBusinessInformationMetadata } from "@/lib/api/location-business-information"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useBusinessInformation(id: string) {
  return useQuery({ queryKey: queryKeys.locationBusinessInformation(id), queryFn: (ctx) => fetchBusinessInformation(id, requestOptions(ctx)) })
}

export function useBusinessInformationMetadata(id: string, type: "categories" | "chains", query: string) {
  return useQuery({
    queryKey: queryKeys.businessInformationMetadata(id, type, query),
    queryFn: (ctx) => fetchBusinessInformationMetadata(id, { type, query }, requestOptions(ctx)),
    enabled: query.trim().length > 0, // the route 400s on an empty query
  })
}
