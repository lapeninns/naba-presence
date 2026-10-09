import { apiFetch, type RequestOptions } from "./client"
import {
  type ConnectStartBody,
  connectStartResponseSchema,
  connectionsResponseSchema,
  disconnectResponseSchema,
} from "@/lib/contracts/connections"

export {
  connectionSummarySchema,
  connectionsResponseSchema,
  type ConnectionSummary,
} from "@/lib/contracts/connections"

export function fetchConnections(options?: RequestOptions) {
  return apiFetch("/api/google/connections", {
    schema: connectionsResponseSchema,
    ...options,
  })
}

export function startGoogleConnect(input: ConnectStartBody = {}) {
  return apiFetch("/api/google/connect/start", {
    method: "POST",
    body: input,
    schema: connectStartResponseSchema,
  })
}

export function disconnectConnection(id: string) {
  return apiFetch(`/api/google/connections/${id}/disconnect`, {
    method: "POST",
    body: {},
    schema: disconnectResponseSchema,
  })
}
