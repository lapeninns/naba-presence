/**
 * Wire contract for `/api/sync/**` (backfill, sweep, reconcile, performance,
 * keywords, presence-resources).
 *
 * Client-safe: no `server-only`, no `lib/server` imports. The routes parse
 * bodies with the request schemas — several of them deliberately inside the
 * handler, after the kill switch and hybrid session-or-cron auth, so the
 * 401/403/503/400 ordering is preserved; `lib/api/backfill.ts` parses
 * responses with the backfill response schemas.
 */
import { z } from "zod"

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * `sync_checkpoint.status` for a backfill, plus the synthetic `not_started`
 * the progress projection uses for a location with no checkpoint row yet.
 *
 * `dead` is terminal: `MAX_CONSECUTIVE_FAILURES` in `lib/server/reviews.ts`
 * retires a checkpoint no retry can fix, and every claim predicate is an
 * allowlist, so the row leaves the retry window for good (0030). It belongs
 * in the vocabulary because the progress counts are keyed by it — omitting it
 * dropped `dead` out of the counts and let a retired location read as merely
 * stalled.
 */
export const BACKFILL_STATUSES = [
  "not_started",
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "dead",
] as const
export type BackfillStatus = (typeof BACKFILL_STATUSES)[number]

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

const externalLocationIds = z.array(z.uuid()).max(50)

/** POST `/api/sync/backfill` body. */
export const backfillStartSchema = z.object({
  externalLocationIds: externalLocationIds.optional(),
  maxPagesPerLocation: z.number().int().min(1).max(20).default(10),
})
export type BackfillStartInput = z.input<typeof backfillStartSchema>

/** DELETE `/api/sync/backfill` body. */
export const backfillCancelSchema = z.object({
  externalLocationIds: z.array(z.uuid()).min(1).max(50),
})
export type BackfillCancelInput = z.infer<typeof backfillCancelSchema>

/** POST `/api/sync/sweep` body. */
export const sweepSchema = z.object({
  externalLocationIds: externalLocationIds.optional(),
  organisationCursor: z.uuid().optional(),
  maxOrganisations: z.number().int().min(1).max(100).default(25),
  maxPagesPerLocation: z.number().int().min(1).max(50).default(50),
})
export type SweepInput = z.input<typeof sweepSchema>

/** POST `/api/sync/reconcile` body. */
export const reconcileSchema = z.object({
  externalLocationIds: externalLocationIds.optional(),
  organisationCursor: z.uuid().optional(),
  maxOrganisations: z.number().int().min(1).max(100).default(25),
})
export type ReconcileInput = z.input<typeof reconcileSchema>

/** POST `/api/sync/performance` body. */
export const performanceSyncSchema = z.object({
  externalLocationId: z.uuid().optional(),
  organisationCursor: z.uuid().optional(),
  maxOrganisations: z.number().int().min(1).max(100).default(25),
  maxLocations: z.number().int().min(1).max(50).default(25),
})
export type PerformanceSyncInput = z.input<typeof performanceSyncSchema>

/** POST `/api/sync/keywords` body. */
export const keywordsSyncSchema = z.object({
  externalLocationId: z.uuid().optional(),
  organisationCursor: z.uuid().optional(),
  maxOrganisations: z.number().int().min(1).max(100).default(25),
  maxLocations: z.number().int().min(1).max(25).default(10),
})
export type KeywordsSyncInput = z.input<typeof keywordsSyncSchema>

/** POST `/api/sync/presence-resources` body (cron only). */
export const presenceResourcesSyncSchema = z.object({
  organisationCursor: z.uuid().optional(),
  maxOrganisations: z.number().int().min(1).max(25).default(10),
  maxLocations: z.number().int().min(1).max(10).default(5),
})
export type PresenceResourcesSyncInput = z.infer<typeof presenceResourcesSyncSchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const backfillItemSchema = z.object({
  externalLocationId: z.string(),
  locationName: z.string().nullable(),
  status: z.string(),
  attemptCount: z.number(),
  hasMorePages: z.boolean(),
  lastErrorCode: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  nextAttemptAt: z.string().nullable(),
})
export type BackfillItem = z.infer<typeof backfillItemSchema>

export const backfillProgressSchema = z.object({
  items: z.array(backfillItemSchema),
  counts: z.record(z.string(), z.number()),
  total: z.number(),
})
export type BackfillProgress = z.infer<typeof backfillProgressSchema>

/** GET `/api/sync/backfill` response. */
export const backfillProgressResponseSchema = z.object({
  progress: backfillProgressSchema,
})
export type BackfillProgressResponse = z.infer<typeof backfillProgressResponseSchema>

/** POST `/api/sync/backfill` response; the batch envelope is passed through. */
export const backfillStartResponseSchema = z
  .object({ progress: backfillProgressSchema })
  .loose()
export type BackfillStartResponse = z.infer<typeof backfillStartResponseSchema>

/** DELETE `/api/sync/backfill` response; the cancelled ids are passed through. */
export const backfillCancelResponseSchema = z
  .object({ progress: backfillProgressSchema })
  .loose()
export type BackfillCancelResponse = z.infer<typeof backfillCancelResponseSchema>
