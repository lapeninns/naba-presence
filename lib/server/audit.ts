import "server-only"

import type { TransactionSql } from "postgres"

export async function writeAudit(
  sql: TransactionSql,
  event: {
    organisationId: string
    actorUserId?: string | null
    action: string
    subjectType: string
    subjectId: string
    requestId?: string | null
    metadata?: Record<string, unknown>
  }
) {
  await sql`
    insert into audit_log (
      organisation_id,
      actor_user_id,
      action,
      subject_type,
      subject_id,
      request_id,
      metadata
    )
    values (
      ${event.organisationId},
      ${event.actorUserId ?? null},
      ${event.action},
      ${event.subjectType},
      ${event.subjectId},
      ${event.requestId ?? null},
      ${sql.json(JSON.parse(JSON.stringify(event.metadata ?? {})))}
    )
    on conflict (organisation_id, request_id, action, subject_type, subject_id)
    do nothing
  `
}
