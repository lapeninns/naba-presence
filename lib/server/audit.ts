import "server-only"

import type { TransactionSql } from "postgres"

import { redactForLog } from "@/lib/domain/redaction"

function truncateAuditStrings(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, 200)
  if (Array.isArray(value)) return value.map(truncateAuditStrings)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        truncateAuditStrings(item),
      ])
    )
  }
  return value
}

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
  const metadata = truncateAuditStrings(
    redactForLog(event.metadata ?? {})
  ) as Record<string, unknown>
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
      ${sql.json(JSON.parse(JSON.stringify(metadata)))}
    )
    on conflict (organisation_id, request_id, action, subject_type, subject_id)
    do nothing
  `
}
