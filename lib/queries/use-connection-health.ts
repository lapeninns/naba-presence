"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchConnections } from "@/lib/api/connections"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"
import { SEEDED_BY_SHELL } from "./use-shell-status"

export type ConnectionHealth =
  | "loading"
  | "connected"
  | "disconnected"
  | "stale"
  | "error"

const LABELS: Record<ConnectionHealth, string> = {
  connected: "Live data",
  loading: "Checking live data",
  stale: "Live data may be stale",
  disconnected: "Google disconnected",
  error: "Live data unavailable",
}

export function useConnectionHealth() {
  const query = useQuery({
    queryKey: queryKeys.connections,
    queryFn: (ctx) => fetchConnections(requestOptions(ctx)),
    // Kept current by the shell's one poll (useShellStatus).
    ...SEEDED_BY_SHELL,
  })
  const status: ConnectionHealth = query.data
    ? query.data.connections.some((c) => c.status === "active")
      ? "connected"
      : "disconnected"
    : query.isError
      ? "error"
      : "loading"
  const finalStatus: ConnectionHealth =
    query.isError && query.data ? "stale" : status
  return { status: finalStatus, label: LABELS[finalStatus] }
}
