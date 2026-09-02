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
import { ApiError } from "@/lib/server/http"
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

/**
 * Google's own dedupe id for locations.create -- the `requestId` query
 * parameter googleLocationCreateRequest builds (lib/domain/google-contract.ts).
 *
 * It must identify the location being created, never the HTTP request:
 * `ctx.requestId` is a fresh UUID per request (lib/server/http.ts), so a
 * client that retries after a lost response used to arrive with a different
 * one and defeat the single server-side guard against a second real Google
 * listing. Creating a location is the one irreversible mutation on these
 * surfaces, so its dedupe key is derived from the content instead.
 *
 * Shaped as a v5 UUID because Google documents the parameter as a UUID; the
 * bytes are the content digest, so the same intent always yields the same id.
 */
export function googleCreateRequestId(input: {
  organisationId: string
  accountName: string
  payload: unknown
}): string {
  const digest = sha256(
    [
      input.organisationId,
      input.accountName,
      stableGoogleHash(input.payload),
    ].join(":")
  )
  const variant = ((parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(
    16
  )
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-")
}

/**
 * The gbp_management_mutation key. It is deliberately still request-scoped:
 * `startGbpMutation` replays ANY existing row for the key as idempotent, so a
 * content-derived key would make a failed patch permanently unretryable and
 * would swallow legitimate repeats these surfaces support (resending a
 * verification PIN, re-adding an admin, patching a field back to an earlier
 * value). Deduplicating a client retry needs a token the client mints per
 * user intent and resends unchanged; until it sends one, the ledger row is
 * per-request and Google's own `requestId` guards the irreversible create
 * (see googleCreateRequestId).
 */
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
    if (created) {
      return { id: created.id, status: created.rawStatus, idempotent: false }
    }
    // `start` claims the key with `on conflict do nothing`, so null means a
    // concurrent request inserted this key first. Answer from its row, the
    // same as if `find` had seen it -- the alternative is a unique violation
    // that aborts the tenant transaction and surfaces as a 500.
    const winner = await gbpManagementAttemptStore.find(sql, {
      organisationId: input.organisationId,
      key,
    })
    if (!winner) {
      throw new ApiError(
        409,
        "gbp_mutation_in_progress",
        "This change is already being applied."
      )
    }
    return { id: winner.id, status: winner.rawStatus, idempotent: true }
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
