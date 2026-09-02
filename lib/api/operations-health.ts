import { z } from "zod"

import { apiFetch, type RequestOptions } from "./client"

const countRowSchema = z.object({
  status: z.string(),
  count: z.number(),
})

const rejectionRowSchema = z.object({
  code: z.string(),
  count: z.number(),
})

const operationsHealthSchema = z.object({
  generatedAt: z.string(),
  sync: z
    .object({
      running: z.number().nullable().optional(),
      pending: z.number().nullable().optional(),
      failed: z.number().nullable().optional(),
      lastSuccessfulReviewUpdate: z.string().nullable().optional(),
      oldestOutstandingAt: z.string().nullable().optional(),
    })
    .passthrough(),
  webhooks: z
    .object({
      backlog: z.number().nullable().optional(),
      oldestBacklogAt: z.string().nullable().optional(),
      failures24h: z.number().nullable().optional(),
    })
    .passthrough(),
  connections: z.array(countRowSchema),
  publish24h: z.array(countRowSchema),
  replyRejections30d: z.array(rejectionRowSchema),
  providerTotalDivergence30d: z.number(),
  failedWebhookEvents: z.number(),
  deadWebhookEvents: z.number(),
  oldestFailedEventAgeSeconds: z.number().nullable(),
  ambiguousPublishAttempts: z.number(),
  staleStartedAttempts: z.number(),
  dueJobBacklog: z.number(),
  checkpointFailures24h: z.number(),
  connectionErrors24h: z.number(),
  schedulerHeartbeatAt: z.string().nullable(),
})
export type OperationsHealth = z.infer<typeof operationsHealthSchema>

export function fetchOperationsHealth(options?: RequestOptions): Promise<OperationsHealth> {
  return apiFetch("/api/operations/health", { schema: operationsHealthSchema, ...options })
}

const webhookFailureSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  status: z.string(),
  retryCount: z.number(),
  nextAttemptAt: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  receivedAt: z.string(),
})
export type WebhookFailure = z.infer<typeof webhookFailureSchema>

export function fetchWebhookFailures(options?: RequestOptions): Promise<WebhookFailure[]> {
  return apiFetch("/api/webhooks/google/pubsub/failures", {
    schema: z.object({ items: z.array(webhookFailureSchema) }),
    ...options,
  }).then((r) => r.items)
}

export function replayWebhookFailure(eventId: string) {
  return apiFetch("/api/webhooks/google/pubsub/replay", {
    method: "POST",
    body: { eventId },
    schema: z
      .object({
        status: z.string(),
        sync: z.unknown().optional(),
      })
      .passthrough(),
  })
}
