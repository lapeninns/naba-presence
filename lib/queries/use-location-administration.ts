"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchAdministration } from "@/lib/api/location-administration"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useAdministration(id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.locationAdministration(id),
    queryFn: (ctx) => fetchAdministration(id, requestOptions(ctx)),
    enabled: options?.enabled ?? true, // D4: pass canEditCanonical so a non-owner never fires the 403 GET
  })
}
