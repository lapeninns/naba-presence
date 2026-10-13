import { apiFetch, type RequestOptions } from "./client"
import type { ConnectStartBody } from "@/lib/contracts/connections"

// Schemas load on demand (see `ResponseSchema` in ./client): the shell's
// reconnect banner reads the connections list on every page, and the
// contract pulls in zod.
export type { ConnectionSummary } from "@/lib/contracts/connections"

const contract = () => import("@/lib/contracts/connections")

export function fetchConnections(options?: RequestOptions) {
  return apiFetch("/api/google/connections", {
    schema: () => contract().then((m) => m.connectionsResponseSchema),
    ...options,
  })
}

export function startGoogleConnect(input: ConnectStartBody = {}) {
  return apiFetch("/api/google/connect/start", {
    method: "POST",
    body: input,
    schema: () => contract().then((m) => m.connectStartResponseSchema),
  })
}

export function disconnectConnection(id: string) {
  return apiFetch(`/api/google/connections/${id}/disconnect`, {
    method: "POST",
    body: {},
    schema: () => contract().then((m) => m.disconnectResponseSchema),
  })
}
