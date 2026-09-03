import "server-only"

import { AsyncLocalStorage } from "node:async_hooks"

import type { TransactionSql } from "postgres"

import { redactForLog } from "@/lib/domain/redaction"

/**
 * Who is really acting, when that is not the user the row is attributed to.
 *
 * A support impersonation session (`app/api/support/impersonation/route.ts`)
 * mints a real session for the customer's own user id, so every audit row it
 * writes reads `actorUserId = <the customer>`. There is no second identity to
 * put in the column -- the row must stay attributable to the tenant it
 * belongs to -- so the support engineer goes into the metadata instead.
 */
export type AuditActor = {
  supportActor?: string | null
  impersonationReason?: string | null
}

/**
 * Ambient because `writeAudit` is called from ~90 handlers and the only place
 * that sees both the session and every audit write is the `route()` wrapper
 * (`lib/server/route.ts`), which does not call `writeAudit` itself. A
 * database-side trigger cannot do it either: `withTenant` sets only
 * `app.organisation_id`. Empty for cron, Pub/Sub push and the jobs runner,
 * none of which can be impersonated.
 */
const auditActor = new AsyncLocalStorage<AuditActor>()

/** Runs `fn` with every `writeAudit` inside it marked as impersonated. */
export function withAuditActor<T>(actor: AuditActor, fn: () => T): T {
  return auditActor.run(actor, fn)
}

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
    /** Overrides the ambient actor; the wrapper supplies it for every route. */
    supportActor?: string | null
    impersonationReason?: string | null
  }
) {
  const ambient = auditActor.getStore()
  const supportActor = event.supportActor ?? ambient?.supportActor ?? null
  const impersonationReason =
    event.impersonationReason ?? ambient?.impersonationReason ?? null
  // Merged before redaction and truncation so the free-text reason answers to
  // the same 200-character cap and redaction pass as any other metadata.
  const metadata = truncateAuditStrings(
    redactForLog(
      supportActor
        ? { ...(event.metadata ?? {}), supportActor, impersonationReason }
        : (event.metadata ?? {})
    )
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
