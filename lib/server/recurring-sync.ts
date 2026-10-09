import "server-only"

import { getDatabase } from "@/lib/server/db"
import { withAdvisoryLock, type LeaseKey } from "@/lib/server/leases"
import { log } from "@/lib/server/logger"

/**
 * The recurring per-location syncs, run as a queue (0048).
 *
 * A cron fire no longer does the work. It makes sure every linked location
 * in every organisation has a checkpoint of its kind -- one statement for the
 * whole fleet -- and the job runner, every minute, claims whatever is due
 * under its per-organisation fairness cap, lease and time budget. Nothing
 * pages, so nothing can be left behind on a cursor, and a slow organisation
 * delays its own locations only.
 *
 * Each checkpoint carries its own next run: success books the next slot on
 * the kind's grid (next_scheduled_run), failure backs off. The cron cadence
 * only bounds how quickly a newly linked location is noticed.
 */
export type RecurringKind = "reconcile" | "performance" | "keywords"

const LEASES: Record<RecurringKind, LeaseKey> = {
  reconcile: "naba:reconcile",
  performance: "naba:performance",
  keywords: "naba:keywords",
}

export type RecurringEnqueueResult = {
  skipped: boolean
  /** Organisations with at least one linked location of this kind. */
  processed: number
  /** Checkpoints created or re-armed by this fire. */
  queued: number
  /** Always null: the fleet is enqueued in one statement. Kept for the tick contract. */
  nextCursor: null
  failures: never[]
}

/**
 * Enqueue under the kind's lease, which also stamps its heartbeat, so a cron
 * that stops firing shows up as a stale tick in operations health.
 */
export async function enqueueRecurring(
  kind: RecurringKind,
  requestId: string
): Promise<RecurringEnqueueResult> {
  const result = await withAdvisoryLock(LEASES[kind], async () => {
    // Platform-level: ensure_recurring_checkpoints is SECURITY DEFINER and
    // writes routing state only; every review and metric read or write still
    // happens in the runner, inside withTenant().
    const [row] = await getDatabase()<
      { organisationCount: number; queued: number }[]
    >`
      select organisation_count as "organisationCount", queued
      from ensure_recurring_checkpoints(${kind})
    `
    log.info("sync.recurring_enqueued", {
      requestId,
      kind,
      organisations: row?.organisationCount ?? 0,
      queued: row?.queued ?? 0,
    })
    return row
  })
  if ("skipped" in result) {
    return {
      skipped: true,
      processed: 0,
      queued: 0,
      nextCursor: null,
      failures: [],
    }
  }
  return {
    skipped: false,
    processed: result?.organisationCount ?? 0,
    queued: result?.queued ?? 0,
    nextCursor: null,
    failures: [],
  }
}
