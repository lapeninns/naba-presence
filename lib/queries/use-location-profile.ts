"use client"

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query"

import { fetchProfile, type ProfileState } from "@/lib/api/location-profile"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

/**
 * A live profile read records a new observation, which the listing summary
 * and the client hub show; a read served from the stored observation
 * changes nothing, so it refreshes nothing else (W0-04). Saves and publishes
 * invalidate these themselves.
 */
function invalidateObservers(client: QueryClient, id: string) {
  void client.invalidateQueries({ queryKey: queryKeys.listingSummary(id) })
  void client.invalidateQueries({ queryKey: queryKeys.listingSummaries })
  void client.invalidateQueries({ queryKey: queryKeys.clientsAll })
}

export function useProfile(id: string) {
  const client = useQueryClient()
  return useQuery({
    queryKey: queryKeys.locationProfile(id),
    queryFn: async (ctx) => {
      let profile: ProfileState
      try {
        profile = await fetchProfile(id, requestOptions(ctx))
      } catch (error) {
        // A failed live read is recorded too.
        invalidateObservers(client, id)
        throw error
      }
      if (profile.source !== "stored") invalidateObservers(client, id)
      return profile
    },
  })
}

/** "Check Google now": reads Google past the staleness budget. */
export function useRefreshProfile(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => fetchProfile(id, undefined, { refresh: true }),
    onSuccess: (profile) => {
      client.setQueryData(queryKeys.locationProfile(id), profile)
      invalidateObservers(client, id)
    },
  })
}
