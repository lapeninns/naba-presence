import "server-only"

import type { TransactionSql } from "postgres"

import { retryDelayMs } from "@/lib/domain/retry"
import { writeAudit } from "@/lib/server/audit"
import type { SyncOutcome } from "@/lib/server/reviews"

/**
 * Settles a webhook event the caller currently holds.
 *
 * Both UPDATEs are conditional on `status = 'processing'`, so only whoever
 * claimed the row can settle it. A straggler whose claim was already
 * reclaimed, dead-lettered or superseded returns "stale" and writes nothing —
 * without that predicate the slowest actor wins and can record a completed
 * sync as failed, or resurrect a dead-lettered row.
 */
export async function settleWebhookEvent(
  sql: TransactionSql,
  eventId: string,
  outcome: SyncOutcome
): Promise<"processed" | "failed" | "stale"> {
  const [event] = await sql<{ organisationId: string; retryCount: number }[]>`
    select
      organisation_id::text as "organisationId",
      retry_count as "retryCount"
    from processed_webhook_event
    where id = ${eventId}
    limit 1
  `
  if (!event) {
    throw new Error(`Webhook event ${eventId} was not found`)
  }

  if (outcome.status !== "failed") {
    const [settled] = await sql<{ id: string }[]>`
      update processed_webhook_event
      set
        status = 'processed',
        processed_at = now(),
        next_attempt_at = null,
        last_error_code = null,
        lease_expires_at = null
      where id = ${eventId}
        and status = 'processing'
      returning id::text as id
    `
    return settled ? "processed" : "stale"
  }

  const errorCode = outcome.errorCode ?? "sync_failed"
  const [settled] = await sql<{ id: string }[]>`
    update processed_webhook_event
    set
      status = 'failed',
      processed_at = now(),
      next_attempt_at = ${new Date(
        Date.now() + retryDelayMs(event.retryCount + 1)
      )},
      last_error_code = ${errorCode},
      lease_expires_at = null
    where id = ${eventId}
      and status = 'processing'
    returning id::text as id
  `
  if (!settled) return "stale"
  await writeAudit(sql, {
    organisationId: event.organisationId,
    action: "webhook.sync_failed",
    subjectType: "webhook_event",
    subjectId: eventId,
    requestId: crypto.randomUUID(),
    metadata: { outcome },
  })
  return "failed"
}
