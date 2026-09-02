import "server-only"

import type { TransactionSql } from "postgres"

import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { jsonColumn, withTenant } from "@/lib/server/db"
import {
  attemptStore,
  loadLinkedLocation,
  type AttemptStore,
  type LinkedLocation,
} from "@/lib/server/gbp-write"
import type { Session } from "@/lib/server/session"

// Thin façade over lib/server/gbp-write.ts for the "complete GBP management"
// surfaces (business-information.ts, industry-management.ts,
// location-administration.ts), which share the gbp_management_mutation table.
// The signatures below are frozen for those callers; the internals delegate
// to the shared pipeline pieces.

export type GbpLocationContext = Omit<LinkedLocation, "googleAccountId"> & {
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
  const linked = await loadLinkedLocation(sql, session, locationId, {
    requireGoogleAccount: true,
  })
  return {
    ...linked,
    connectionId: linked.googleConnectionId,
    googleAccountId: linked.googleAccountId as string,
    accountName: linked.googleAccountName,
  }
}

/**
 * gbp_management_mutation as an AttemptStore. Its CHECK constraint knows
 * started/validated/succeeded/failed/ambiguous, so the in-flight vocabulary
 * maps onto `started` and "publishing" (validateOnly passed, real call next)
 * onto `validated`.
 */
export const gbpManagementAttemptStore: AttemptStore = attemptStore({
  table: "gbp_management_mutation",
  statuses: {
    validating: "started",
    validated: "validated",
    publishing: "validated",
  },
  columns: {
    errorCode: "last_error_code",
    response: "google_response",
    validatedAt: "validated_at",
  },
})

export function gbpManagementIdempotencyKey(input: {
  resourceType: string
  operation: string
  targetResourceName?: string
  locationId?: string
  googleAccountId?: string
  requestId: string
}) {
  return `${input.resourceType}:${input.operation}:${input.targetResourceName ?? input.locationId ?? input.googleAccountId}:${input.requestId}`
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
  await withTenant(
    input.organisationId,
    (sql) => sql`
    insert into gbp_resource_snapshot (
      organisation_id, location_id, google_account_id, resource_type,
      resource_name, payload, google_hash
    ) values (
      ${input.organisationId}, ${input.locationId ?? null},
      ${input.googleAccountId ?? null}, ${input.resourceType},
      ${input.resourceName},
      ${jsonColumn(sql, input.payload)}, ${hash}
    )
    on conflict (organisation_id, resource_type, resource_name) do update set
      location_id = excluded.location_id,
      google_account_id = excluded.google_account_id,
      payload = excluded.payload,
      google_hash = excluded.google_hash,
      observed_at = now(),
      expires_at = now() + interval '30 days'
  `
  )
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
  const key = gbpManagementIdempotencyKey(input)
  return withTenant(input.organisationId, async (sql) => {
    const existing = await gbpManagementAttemptStore.find(sql, {
      organisationId: input.organisationId,
      key,
    })
    if (existing) {
      return { id: existing.id, status: existing.rawStatus, idempotent: true }
    }
    const created = await gbpManagementAttemptStore.start(sql, {
      organisationId: input.organisationId,
      actorUserId: input.session.userId,
      requestId: input.requestId,
      key,
      existing: null,
      intent: {
        location_id: input.locationId ?? null,
        google_account_id: input.googleAccountId ?? null,
        resource_type: input.resourceType,
        operation: input.operation,
        target_resource_name: input.targetResourceName ?? null,
        expected_google_hash: input.expectedGoogleHash ?? null,
        update_mask: input.updateMask ?? [],
        requested_payload:
          input.payload === undefined
            ? null
            : (txn: TransactionSql) => jsonColumn(txn, input.payload),
      },
    })
    return { id: created.id, status: created.rawStatus, idempotent: false }
  })
}

export async function settleGbpMutation(input: {
  organisationId: string
  mutationId: string
  status: "validated" | "succeeded" | "failed" | "ambiguous"
  response?: unknown
  errorCode?: string
}) {
  await withTenant(input.organisationId, (sql) =>
    input.status === "validated"
      ? gbpManagementAttemptStore.markPublishing(sql, {
          id: input.mutationId,
          validated: true,
        })
      : gbpManagementAttemptStore.settle(sql, {
          id: input.mutationId,
          status: input.status,
          errorCode: input.errorCode ?? null,
          response: input.response,
        })
  )
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
