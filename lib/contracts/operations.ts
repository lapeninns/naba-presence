/**
 * Wire contract for `/api/operations/health`, `/api/audit-log` and the
 * webhook failure/replay endpoints the operations panel reads.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. The audit-log
 * route parses its query with `auditLogQuerySchema`. The response schemas
 * describe the operations-health and audit-log routes, which are API-only:
 * their Settings consoles were removed (components/settings/settings-nav.tsx),
 * so no browser code parses them today.
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
export const webhookReplaySchema = z.object({ eventId: z.uuid() })
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

/**
 * One scheduled tick's liveness. `lastCompletedAt` is the `ops_heartbeat` row
 * the tick's advisory lease stamps when a run completes, and
 * `staleAfterSeconds` is the multiple of that tick's documented interval past
 * which the absence of a run is worth acting on. A tick that has never
 * completed reports `null` and `stale: true`.
 */
export const schedulerTickSchema = z.object({
  name: z.string(),
  lastCompletedAt: z.string().nullable(),
  staleAfterSeconds: z.number(),
  stale: z.boolean(),
})
export type SchedulerTick = z.infer<typeof schedulerTickSchema>

/**
 * GET `/api/operations/health` response (session scope).
 *
 * Fields added after the first release carry a `.default(...)`: a browser
 * holding an open panel can outlive a rollback, and a health panel that
 * refuses to render because one counter is missing is worse than one that
 * renders the counter as zero.
 */
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
  // Every due item, whichever tick owns it. Deliberately not narrowed to the
  // job runner's share: a `performance` checkpoint the metrics cron will
  // claim is real backlog, and hiding it would make the aggregate lie in the
  // other direction. The five fields below say who owes each unit of it.
  dueJobBacklog: z.number(),
  dueWebhookBacklog: z.number().default(0),
  /** `backfill` / `sweep` — exactly what `claim_due_jobs` can claim. */
  dueRunnerCheckpointBacklog: z.number().default(0),
  /** `performance` / `keywords` — drained by their own crons, not the runner. */
  dueMetricsCheckpointBacklog: z.number().default(0),
  /** `reconcile` / `notification` — no claimer; 0030's terminal state drains these. */
  dueReconcileBacklog: z.number().default(0),
  dueUnclaimedCheckpointBacklog: z.number().default(0),
  duePublishBacklog: z.number().default(0),
  checkpointFailures24h: z.number(),
  connectionErrors24h: z.number(),
  /** Connections whose Google refresh token expires within three days. */
  refreshTokensExpiringSoon: z.number().default(0),
  /**
   * How long the worst actively linked location has gone without a
   * SUCCESSFUL reconcile (a failed one does not count), worst tenant first.
   */
  reconcileStalenessSeconds: z.number().nullable().default(null),
  /** The same for the daily deleted-review sweep. */
  sweepStalenessSeconds: z.number().nullable().default(null),
  /** Linked listings the connected login can no longer reach. */
  listingsAccessLost: z.number().default(0),
  /** Locations a live legal hold keeps past their disconnect purge date. */
  heldPurgeLocations: z.number().default(0),
  /** How long the oldest still-unpurged disconnected connection is overdue. */
  pendingPurgeAgeSeconds: z.number().nullable().default(null),
  schedulerHeartbeatAt: z.string().nullable(),
  schedulerHeartbeatStale: z.boolean().default(false),
  schedulerTicks: z.array(schedulerTickSchema).default([]),
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
export type WebhookFailuresResponse = z.infer<
  typeof webhookFailuresResponseSchema
>

/** POST `/api/webhooks/google/pubsub/replay` response. */
export const webhookReplayResponseSchema = z
  .object({
    status: z.string(),
    sync: z.unknown().optional(),
  })
  .passthrough()
export type WebhookReplayResponse = z.infer<typeof webhookReplayResponseSchema>
