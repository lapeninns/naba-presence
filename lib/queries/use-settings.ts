"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchSettings } from "@/lib/api/settings"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: (ctx) => fetchSettings(requestOptions(ctx)) })
}
