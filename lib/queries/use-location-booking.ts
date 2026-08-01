"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchPlaceActions } from "@/lib/api/location-booking"
import { queryKeys } from "./keys"

export function usePlaceActions(id: string) {
  return useQuery({ queryKey: queryKeys.locationBooking(id), queryFn: () => fetchPlaceActions(id), staleTime: 30_000 })
}
