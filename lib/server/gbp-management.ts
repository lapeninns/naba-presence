import "server-only"

import type { TransactionSql } from "postgres"

import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import {
  canPublishLocation,
  requireLocationAccess,
} from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

export type GbpLocationContext = {
  externalLocationId: string
  connectionId: string
  googleAccountId: string
  accountName: string
  googleLocationName: string
  canPublish: boolean
}

export function stableGoogleHash(value: unknown) {
  const canonical = (entry: unknown): string => {
    if (Array.isArray(entry)) return `[${entry.map(canonical).join(",")}]`
    if (entry && typeof entry === "object") {
      return `{${Object.entries(entry as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
        .join(",")}}`
    }
    return JSON.stringify(entry)
  }
  return sha256(canonical(value))
}

export async function resolveGbpLocationContext(
  sql: TransactionSql,
  session: Session,
  locationId: string
): Promise<GbpLocationContext> {
  await requireLocationAccess(sql, session, locationId)
  const [row] = await sql<Omit<GbpLocationContext, "canPublish">[]>`
    select
      el.id::text as "externalLocationId",
      el.google_connection_id::text as "connectionId",
      ga.id::text as "googleAccountId",
      el.google_account_name as "accountName",
      el.google_location_name as "googleLocationName"
    from location_link ll
    join external_location el on el.id = ll.external_location_id
    join google_account ga
      on ga.google_connection_id = el.google_connection_id
     and ga.google_account_name = el.google_account_name
    where ll.location_id = ${locationId}
      and ll.is_active = true
    limit 1
  `
  if (!row) {
    throw new ApiError(
      409,
      "google_location_not_linked",
      "Link this location to Google first."
    )
  }
  return {
    ...row,
    canPublish: await canPublishLocation(sql, session, locationId),
  }
}

export async function cacheGbpSnapshot(input: {
  organisationId: string
  locationId?: string
  googleAccountId?: string
  resourceType: string
  resourceName: string
  payload: unknown
}) {
  const hash = stableGoogleHash(input.payload)
  await withTenant(input.organisationId, (sql) => sql`
    insert into gbp_resource_snapshot (
      organisation_id, location_id, google_account_id, resource_type,
      resource_name, payload, google_hash
    ) values (
      ${input.organisationId}, ${input.locationId ?? null},
      ${input.googleAccountId ?? null}, ${input.resourceType},
      ${input.resourceName},
      ${sql.json(JSON.parse(JSON.stringify(input.payload)) as never)}, ${hash}
    )
    on conflict (organisation_id, resource_type, resource_name) do update set
      location_id = excluded.location_id,
      google_account_id = excluded.google_account_id,
      payload = excluded.payload,
      google_hash = excluded.google_hash,
      observed_at = now(),
      expires_at = now() + interval '30 days'
  `)
  return hash
}

export async function startGbpMutation(input: {
  organisationId: string
  session: Session
  locationId?: string
  googleAccountId?: string
  resourceType: string
  operation: string
  targetResourceName?: string
  requestId: string
  expectedGoogleHash?: string
  updateMask?: string[]
  payload?: unknown
}) {
  const idempotencyKey = `${input.resourceType}:${input.operation}:${input.targetResourceName ?? input.locationId ?? input.googleAccountId}:${input.requestId}`
  return withTenant(input.organisationId, async (sql) => {
    const [existing] = await sql<{ id: string; status: string }[]>`
      select id::text as id, status
      from gbp_management_mutation
      where idempotency_key = ${idempotencyKey}
    `
    if (existing) return { ...existing, idempotent: true }
    const [created] = await sql<{ id: string; status: string }[]>`
      insert into gbp_management_mutation (
        organisation_id, location_id, google_account_id, actor_user_id,
        resource_type, operation, target_resource_name, status,
        idempotency_key, expected_google_hash, update_mask,
        requested_payload
      ) values (
        ${input.organisationId}, ${input.locationId ?? null},
        ${input.googleAccountId ?? null}, ${input.session.userId},
        ${input.resourceType}, ${input.operation},
        ${input.targetResourceName ?? null}, 'started', ${idempotencyKey},
        ${input.expectedGoogleHash ?? null}, ${input.updateMask ?? []},
        ${input.payload === undefined ? null : sql.json(JSON.parse(JSON.stringify(input.payload)) as never)}
      )
      returning id::text as id, status
    `
    return { ...created, idempotent: false }
  })
}

export async function settleGbpMutation(input: {
  organisationId: string
  mutationId: string
  status: "validated" | "succeeded" | "failed" | "ambiguous"
  response?: unknown
  errorCode?: string
}) {
  await withTenant(input.organisationId, (sql) => sql`
    update gbp_management_mutation set
      status = ${input.status},
      google_response = ${input.response === undefined ? null : sql.json(JSON.parse(JSON.stringify(input.response)) as never)},
      last_error_code = ${input.errorCode ?? null},
      validated_at = case when ${input.status} in ('validated', 'succeeded')
        then coalesce(validated_at, now()) else validated_at end,
      finished_at = case when ${input.status} in ('succeeded', 'failed', 'ambiguous')
        then now() else finished_at end
    where id = ${input.mutationId}
  `)
}

export async function auditGbpMutation(input: {
  organisationId: string
  session: Session
  action: string
  subjectType: string
  subjectId: string
  requestId: string
  metadata?: Record<string, unknown>
}) {
  await withTenant(input.organisationId, (sql) =>
    writeAudit(sql, {
      organisationId: input.organisationId,
      actorUserId: input.session.userId,
      action: input.action,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      requestId: input.requestId,
      metadata: input.metadata,
    })
  )
}
