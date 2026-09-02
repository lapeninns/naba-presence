"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchFoodMenus } from "@/lib/api/location-menu"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useFoodMenus(id: string) {
  return useQuery({ queryKey: queryKeys.locationMenu(id), queryFn: (ctx) => fetchFoodMenus(id, requestOptions(ctx)) })
}
