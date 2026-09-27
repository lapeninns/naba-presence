"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"

import { fetchProfile } from "@/lib/api/location-profile"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useProfile(id: string) {
  const client = useQueryClient()
  return useQuery({
    queryKey: queryKeys.locationProfile(id),
    queryFn: async (ctx) => {
      try {
        return await fetchProfile(id, requestOptions(ctx))
      } finally {
        void client.invalidateQueries({
          queryKey: queryKeys.listingSummary(id),
        })
        void client.invalidateQueries({ queryKey: queryKeys.listingSummaries })
        void client.invalidateQueries({ queryKey: queryKeys.clientsAll })
      }
    },
  })
}
