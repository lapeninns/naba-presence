import { z } from "zod"

import { apiFetch, type RequestOptions } from "./client"

export const connectionSummarySchema = z.object({
  id: z.string(),
  googleEmail: z.string().nullable(),
  status: z.string(),
  scope: z.string().optional(),
  notificationsEnabled: z.boolean(),
  lastRefreshAt: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  reconnectRequired: z.boolean(),
  createdAt: z.string(),
})

export const connectionsResponseSchema = z.object({
  connections: z.array(connectionSummarySchema),
})

export type ConnectionSummary = z.infer<typeof connectionSummarySchema>

export function fetchConnections(options?: RequestOptions) {
  return apiFetch("/api/google/connections", {
    schema: connectionsResponseSchema,
    ...options,
  })
}

const authorizationResponseSchema = z.object({ authorizationUrl: z.string() })
const disconnectResponseSchema = z.object({ status: z.literal("disconnected") })

export function startGoogleConnect() {
  return apiFetch("/api/google/connect/start", { method: "POST", body: {}, schema: authorizationResponseSchema })
}

export function disconnectConnection(id: string) {
  return apiFetch(`/api/google/connections/${id}/disconnect`, {
    method: "POST",
    body: {},
    schema: disconnectResponseSchema,
  })
}
