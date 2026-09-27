"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"

import { fetchHours } from "@/lib/api/location-hours"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useHours(id: string) {
  const client = useQueryClient()
  return useQuery({
    queryKey: queryKeys.locationHours(id),
    queryFn: async (ctx) => {
      try {
        return await fetchHours(id, requestOptions(ctx))
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
