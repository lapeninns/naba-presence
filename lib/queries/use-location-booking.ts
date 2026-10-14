"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { fetchPlaceActions } from "@/lib/api/location-booking"
import { GOOGLE_LIVE_READ } from "./google-live"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function usePlaceActions(id: string) {
  return useQuery({
    queryKey: queryKeys.locationBooking(id),
    queryFn: (ctx) => fetchPlaceActions(id, requestOptions(ctx)),
    ...GOOGLE_LIVE_READ,
  })
}

/** "Check Google now": reads Google's links past the staleness budget. */
export function useRefreshPlaceActions(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => fetchPlaceActions(id, undefined, { refresh: true }),
    onSuccess: (state) => {
      client.setQueryData(queryKeys.locationBooking(id), state)
      // The listing summary counts the links this read refreshed.
      void client.invalidateQueries({ queryKey: queryKeys.listingSummary(id) })
    },
  })
}
