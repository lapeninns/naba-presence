import { z } from "zod"

import { apiFetch } from "./client"

export const BACKFILL_STATUSES = [
  "not_started",
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const
export type BackfillStatus = (typeof BACKFILL_STATUSES)[number]

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

export const backfillProgressSchema = z.object({
  items: z.array(backfillItemSchema),
  counts: z.record(z.string(), z.number()),
  total: z.number(),
})

const progressResponseSchema = z.object({ progress: backfillProgressSchema })
const startResponseSchema = z.object({ progress: backfillProgressSchema }).loose()
const cancelResponseSchema = z.object({ progress: backfillProgressSchema }).loose()

export type BackfillItem = z.infer<typeof backfillItemSchema>
export type BackfillProgress = z.infer<typeof backfillProgressSchema>

export function fetchBackfillProgress(externalLocationId?: string) {
  const path = externalLocationId
    ? `/api/sync/backfill?external_location_id=${encodeURIComponent(externalLocationId)}`
    : "/api/sync/backfill"
  return apiFetch(path, { schema: progressResponseSchema })
}

export function startBackfill(input: { externalLocationIds?: string[]; maxPagesPerLocation: number }) {
  return apiFetch("/api/sync/backfill", { method: "POST", body: input, schema: startResponseSchema })
}

export function cancelBackfill(externalLocationIds: string[]) {
  return apiFetch("/api/sync/backfill", {
    method: "DELETE",
    body: { externalLocationIds },
    schema: cancelResponseSchema,
  })
}
