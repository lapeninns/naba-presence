import "server-only"

import type { TransactionSql } from "postgres"

import { retryDelayMs } from "@/lib/domain/retry"
import { writeAudit } from "@/lib/server/audit"
import type { SyncOutcome } from "@/lib/server/reviews"

export async function settleWebhookEvent(
  sql: TransactionSql,
  eventId: string,
  outcome: SyncOutcome
): Promise<"processed" | "failed"> {
  const [event] = await sql<
    { organisationId: string; retryCount: number }[]
  >`
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
    await sql`
      update processed_webhook_event
      set
        status = 'processed',
        processed_at = now(),
        next_attempt_at = null,
        last_error_code = null
      where id = ${eventId}
    `
    return "processed"
  }

  const errorCode = outcome.errorCode ?? "sync_failed"
  await sql`
    update processed_webhook_event
    set
      status = 'failed',
      processed_at = now(),
      next_attempt_at = ${
        new Date(Date.now() + retryDelayMs(event.retryCount + 1))
      },
      last_error_code = ${errorCode}
    where id = ${eventId}
  `
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
