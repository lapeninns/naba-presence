/**
 * Wire contract for `/api/operations/health`, `/api/audit-log` and the
 * webhook failure/replay endpoints the operations panel reads.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. The audit-log
 * route parses its query with `auditLogQuerySchema`;
 * `lib/api/operations-health.ts` parses responses with the response schemas.
 */
import { z } from "zod"

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * GET `/api/audit-log` query, after the route decodes `page_size` to a
 * number and the base64url `cursor` to its object form.
 */
export const auditLogQuerySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  action: z.string().trim().max(120).optional(),
  pageSize: z.number().int().min(1).max(1000).default(200),
  cursor: z.object({ createdAt: z.iso.datetime(), id: z.uuid() }).optional(),
})
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>

/** POST `/api/webhooks/google/pubsub/replay` body. */
export const webhookReplaySchema = z.object({ eventId: z.string() })
export type WebhookReplayInput = z.infer<typeof webhookReplaySchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

const countRowSchema = z.object({
  status: z.string(),
  count: z.number(),
})

const rejectionRowSchema = z.object({
  code: z.string(),
  count: z.number(),
})

/** GET `/api/operations/health` response (session scope). */
export const operationsHealthSchema = z.object({
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

export const webhookFailureSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  status: z.string(),
  retryCount: z.number(),
  nextAttemptAt: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  receivedAt: z.string(),
})
export type WebhookFailure = z.infer<typeof webhookFailureSchema>

/** GET `/api/webhooks/google/pubsub/failures` response. */
export const webhookFailuresResponseSchema = z.object({
  items: z.array(webhookFailureSchema),
})
export type WebhookFailuresResponse = z.infer<typeof webhookFailuresResponseSchema>

/** POST `/api/webhooks/google/pubsub/replay` response. */
export const webhookReplayResponseSchema = z
  .object({
    status: z.string(),
    sync: z.unknown().optional(),
  })
  .passthrough()
export type WebhookReplayResponse = z.infer<typeof webhookReplayResponseSchema>
