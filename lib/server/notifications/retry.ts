import "server-only"

import type { TransactionSql } from "postgres"

import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import type { Session } from "@/lib/server/session"

/**
 * Deliveries an operator may send again. A refused send with no earlier
 * uncertain attempt (failed, not may_have_sent, 0096) is safe to repeat at
 * any age. One that
 * may already have reached the provider (delivery_state unknown; status
 * uncertain, or failed on rows older than 0095) is retried only while
 * the provider still honours its idempotency key (24 hours; 23 here for
 * margin); after that it stays unknown rather than risk a duplicate. The
 * driver checks the window again when the requeued row is claimed
 * (./delivery.ts), since that can be much later. Suppressed and accepted
 * deliveries are never retried.
 */
export function retryableDelivery(sql: TransactionSql) {
  return sql`((status = 'failed' and delivery_state = 'failed' and not may_have_sent)
    or (status in ('failed', 'uncertain') and delivery_state = 'unknown'
      and created_at > now() - interval '23 hours'))`
}

/** Requeues retryable deliveries; the send still rechecks membership, access and preference. */
export async function retryNotificationDeliveries(session: Session, requestId: string) {
  return withTenant(session.organisationId, async (sql) => {
    const rows = await sql<{ id: string }[]>`
      update notification_delivery
      set status = 'pending', attempts = 0, next_attempt_at = now(), delivery_state = 'queued', last_error_code = null
      where ${retryableDelivery(sql)}
      returning id::text as id`
    await writeAudit(sql, { organisationId: session.organisationId, actorUserId: session.userId, action: "notification.deliveries_retried",
      subjectType: "organisation", subjectId: session.organisationId, requestId, metadata: { count: rows.length } })
    return { requeued: rows.length }
  })
}
