"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchSettingsCapabilities } from "@/lib/api/settings-capabilities"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useSettingsCapabilities() {
  return useQuery({
    queryKey: queryKeys.settingsCapabilities,
    queryFn: (ctx) => fetchSettingsCapabilities(requestOptions(ctx)),
  })
}
