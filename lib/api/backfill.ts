import { apiFetch, type RequestOptions } from "./client"
import {
  backfillCancelResponseSchema,
  backfillProgressResponseSchema,
  backfillStartResponseSchema,
  type BackfillCancelInput,
  type BackfillStartInput,
} from "@/lib/contracts/sync"

export {
  BACKFILL_STATUSES,
  backfillItemSchema,
  backfillProgressSchema,
  type BackfillItem,
  type BackfillProgress,
  type BackfillStatus,
} from "@/lib/contracts/sync"

export function fetchBackfillProgress(externalLocationId?: string, options?: RequestOptions) {
  const path = externalLocationId
    ? `/api/sync/backfill?external_location_id=${encodeURIComponent(externalLocationId)}`
    : "/api/sync/backfill"
  return apiFetch(path, { schema: backfillProgressResponseSchema, ...options })
}

export function startBackfill(input: BackfillStartInput) {
  return apiFetch("/api/sync/backfill", {
    method: "POST",
    body: input,
    schema: backfillStartResponseSchema,
  })
}

export function cancelBackfill(externalLocationIds: string[]) {
  return apiFetch("/api/sync/backfill", {
    method: "DELETE",
    body: { externalLocationIds } satisfies BackfillCancelInput,
    schema: backfillCancelResponseSchema,
  })
}
