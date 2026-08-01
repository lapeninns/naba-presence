"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchFoodMenus } from "@/lib/api/location-menu"
import { queryKeys } from "./keys"

export function useFoodMenus(id: string) {
  return useQuery({ queryKey: queryKeys.locationMenu(id), queryFn: () => fetchFoodMenus(id), staleTime: 30_000 })
}
