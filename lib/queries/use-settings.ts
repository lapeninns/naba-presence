"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchSettings } from "@/lib/api/settings"
import { queryKeys } from "./keys"

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: fetchSettings, staleTime: 30_000 })
}
