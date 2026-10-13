"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchConnections } from "@/lib/api/connections"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

/**
 * Just the connections list, on the same cache entry as the workspace
 * (./use-connection-workspace.ts). For the shell's reconnect banner, which
 * renders outside any page, must not depend on the toast provider, and is
 * on every page: this module stays free of the mutation and error-copy code.
 */
export function useConnectionsQuery() {
  return useQuery({
    queryKey: queryKeys.connections,
    queryFn: (ctx) => fetchConnections(requestOptions(ctx)),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}
