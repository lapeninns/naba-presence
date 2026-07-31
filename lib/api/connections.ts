import { z } from "zod"

import { apiFetch } from "./client"

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

export function fetchConnections() {
  return apiFetch("/api/google/connections", {
    schema: connectionsResponseSchema,
  })
}
