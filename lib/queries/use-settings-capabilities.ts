"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchSettingsCapabilities } from "@/lib/api/settings-capabilities"
import { queryKeys } from "./keys"

export function useSettingsCapabilities() {
  return useQuery({
    queryKey: queryKeys.settingsCapabilities,
    queryFn: fetchSettingsCapabilities,
    staleTime: 30_000,
  })
}
