"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchPlaceActions } from "@/lib/api/location-booking"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function usePlaceActions(id: string) {
  return useQuery({ queryKey: queryKeys.locationBooking(id), queryFn: (ctx) => fetchPlaceActions(id, requestOptions(ctx)) })
}
