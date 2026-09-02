"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchProfile } from "@/lib/api/location-profile"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useProfile(id: string) {
  return useQuery({ queryKey: queryKeys.locationProfile(id), queryFn: (ctx) => fetchProfile(id, requestOptions(ctx)) })
}
