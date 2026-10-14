"use client"

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query"

import { fetchHours, type HoursState } from "@/lib/api/location-hours"
import { GOOGLE_LIVE_READ } from "./google-live"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

/**
 * A live hours read records a new observation, which the listing summary
 * and the client hub show; a read served from the stored observation
 * changes nothing, so it refreshes nothing else (W0-04). Saves and publishes
 * invalidate these themselves.
 */
function invalidateObservers(client: QueryClient, id: string) {
  void client.invalidateQueries({ queryKey: queryKeys.listingSummary(id) })
  void client.invalidateQueries({ queryKey: queryKeys.listingSummaries })
  void client.invalidateQueries({ queryKey: queryKeys.clientsAll })
}

export function useHours(id: string) {
  const client = useQueryClient()
  return useQuery({
    queryKey: queryKeys.locationHours(id),
    queryFn: async (ctx) => {
      let hours: HoursState
      try {
        hours = await fetchHours(id, requestOptions(ctx))
      } catch (error) {
        // A failed live read is recorded too.
        invalidateObservers(client, id)
        throw error
      }
      if (hours.source !== "stored") invalidateObservers(client, id)
      return hours
    },
    ...GOOGLE_LIVE_READ,
  })
}

/** "Check Google now": reads Google past the staleness budget. */
export function useRefreshHours(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => fetchHours(id, undefined, { refresh: true }),
    onSuccess: (hours) => {
      client.setQueryData(queryKeys.locationHours(id), hours)
      invalidateObservers(client, id)
    },
  })
}
