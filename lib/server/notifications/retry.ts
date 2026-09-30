import "server-only"

import type { TransactionSql } from "postgres"

import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import type { Session } from "@/lib/server/session"

/**
 * Deliveries an operator may send again. A refused send (failed) is safe to
 * repeat. An unknown one may already have reached the provider, so it is
 * retried only while the provider still honours its idempotency key (24
 * hours; 23 here for margin); after that it stays unknown rather than risk a
 * duplicate. Suppressed and accepted deliveries are never retried.
 */
export function retryableDelivery(sql: TransactionSql) {
  return sql`(status = 'failed' and (delivery_state = 'failed'
    or (delivery_state = 'unknown' and created_at > now() - interval '23 hours')))`
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
