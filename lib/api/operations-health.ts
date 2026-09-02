import { apiFetch, type RequestOptions } from "./client"
import {
  operationsHealthSchema,
  webhookFailuresResponseSchema,
  webhookReplayResponseSchema,
  type OperationsHealth,
  type WebhookFailure,
  type WebhookReplayInput,
} from "@/lib/contracts/operations"

export type { OperationsHealth, WebhookFailure }

export function fetchOperationsHealth(options?: RequestOptions): Promise<OperationsHealth> {
  return apiFetch("/api/operations/health", { schema: operationsHealthSchema, ...options })
}

export function fetchWebhookFailures(options?: RequestOptions): Promise<WebhookFailure[]> {
  return apiFetch("/api/webhooks/google/pubsub/failures", {
    schema: webhookFailuresResponseSchema,
    ...options,
  }).then((r) => r.items)
}

export function replayWebhookFailure(eventId: string) {
  return apiFetch("/api/webhooks/google/pubsub/replay", {
    method: "POST",
    body: { eventId } satisfies WebhookReplayInput,
    schema: webhookReplayResponseSchema,
  })
}
