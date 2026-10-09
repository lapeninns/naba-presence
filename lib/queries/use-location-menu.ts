"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"

import { fetchFoodMenus } from "@/lib/api/location-menu"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useFoodMenus(id: string) {
  const client = useQueryClient()
  return useQuery({
    queryKey: queryKeys.locationMenu(id),
    queryFn: async (ctx) => {
      try {
        return await fetchFoodMenus(id, requestOptions(ctx))
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
