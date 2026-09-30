import { z } from "zod"

import {
  operationsHealthSchema,
  webhookFailuresResponseSchema,
} from "@/lib/contracts/operations"

import { apiFetch, type RequestOptions } from "./client"

export const fetchOperationsHealth = (options?: RequestOptions) =>
  apiFetch("/api/operations/health", { schema: operationsHealthSchema, ...options })
export const fetchWebhookFailures = (options?: RequestOptions) =>
  apiFetch("/api/webhooks/google/pubsub/failures", { schema: webhookFailuresResponseSchema, ...options })
export const replayWebhookEvent = (eventId: string) =>
  apiFetch("/api/webhooks/google/pubsub/replay", { method: "POST", body: { eventId }, schema: z.unknown() })
export const retryNotificationDeliveries = () =>
  apiFetch("/api/operations/notification-deliveries/retry", { method: "POST", body: {}, schema: z.object({ requeued: z.number() }) })
