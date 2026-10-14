import "server-only"

import { getDatabase } from "@/lib/server/db"

/**
 * Operator findings for billing that has stopped converging (R2B-06,
 * migration 0146). Without them a dead-lettered Stripe event, or an
 * organisation every sync fails for, left its record as it was with only a
 * log line: a pilot that had just paid, under a price the catalog lacks,
 * kept full access while the billing cron stayed alive.
 *
 * One finding per organisation and kind; the subject is the organisation
 * id, and the details hold counts, instants and stable codes only. Each
 * resolves on its own once a sync succeeds: that resets the failure run and
 * clears the code, and it is the successful sync a dead event is measured
 * against (the reconcile repairs whatever the event would have applied).
 */

/** Consecutive failed background syncs before billing_sync_failing opens. */
export const BILLING_SYNC_FAILING_AFTER = 3

export type BillingHealthRow = {
  organisationId: string
  deadEvents: number
  oldestDeadAt: Date | null
  deadErrorCode: string | null
  syncFailures: number
  lastSyncErrorCode: string | null
  lastSyncFailedAt: Date | null
}

export type BillingFinding = {
  kind: "billing_event_dead" | "billing_sync_failing" | "billing_plan_unknown"
  subject: string
  details: Record<string, unknown>
}

const iso = (at: Date | null) => at?.toISOString() ?? null

/**
 * A catalog without the subscribed price never heals by retrying, so it
 * opens at the first failure and stands in for billing_sync_failing; any
 * other code opens once the run reaches BILLING_SYNC_FAILING_AFTER.
 */
export function billingFindings(
  rows: readonly BillingHealthRow[]
): BillingFinding[] {
  const findings: BillingFinding[] = []
  for (const row of rows) {
    if (row.deadEvents > 0) {
      findings.push({
        kind: "billing_event_dead",
        subject: row.organisationId,
        details: {
          events: row.deadEvents,
          oldestDeadAt: iso(row.oldestDeadAt),
          lastErrorCode: row.deadErrorCode,
        },
      })
    }
    const failure = {
      failures: row.syncFailures,
      lastErrorCode: row.lastSyncErrorCode,
      lastFailedAt: iso(row.lastSyncFailedAt),
    }
    if (
      row.syncFailures > 0 &&
      row.lastSyncErrorCode === "billing_plan_unknown"
    ) {
      findings.push({
        kind: "billing_plan_unknown",
        subject: row.organisationId,
        details: failure,
      })
    } else if (row.syncFailures >= BILLING_SYNC_FAILING_AFTER) {
      findings.push({
        kind: "billing_sync_failing",
        subject: row.organisationId,
        details: { ...failure, failingAfter: BILLING_SYNC_FAILING_AFTER },
      })
    }
  }
  return findings
}

/** Reads billing_health() (0146) across tenants through its definer. */
export async function billingHealth(): Promise<BillingFinding[]> {
  const rows = await getDatabase()<BillingHealthRow[]>`
    select
      organisation_id::text as "organisationId",
      dead_events as "deadEvents",
      oldest_dead_at as "oldestDeadAt",
      dead_error_code as "deadErrorCode",
      sync_failures as "syncFailures",
      last_sync_error_code as "lastSyncErrorCode",
      last_sync_failed_at as "lastSyncFailedAt"
    from billing_health()
  `
  return billingFindings(rows)
}
