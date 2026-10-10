import "server-only"

import { AsyncLocalStorage } from "node:async_hooks"

import type { TransactionSql } from "postgres"

import {
  INTENT_HEADER,
  intentIdSchema,
  type MutationReceipt,
  type OperationOutcome,
} from "@/lib/contracts/mutation-operations"
import { jsonColumn } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import {
  requireLocationAccess,
  type GrantScope,
} from "@/lib/server/permissions"

/**
 * The mutation operation ledger (supabase/migrations/0067_mutation_operation.sql):
 * one receipt per user intent, keyed by the intent id the client mints and
 * sends as the `Idempotency-Key` header.
 *
 *   same intent, same payload hash      -> the stored receipt; nothing is sent
 *   same intent, different payload hash -> 409 intent_conflict
 *   no intent                           -> no receipt; the write behaves as
 *                                          it always did
 *
 * The receipt is recorded by runGbpWrite (lib/server/gbp-write.ts) inside the
 * transaction that claims the provider attempt, so it is durable before the
 * provider call, and it is settled in the transaction that settles the
 * attempt. A surface takes part by passing an `operation` descriptor to
 * runGbpWrite; the intent itself reaches it from the route wrapper through
 * `withMutationIntent`, the way the audit actor does (lib/server/audit.ts).
 */

// ---------------------------------------------------------------------------
// Request intent
// ---------------------------------------------------------------------------

type AmbientIntent = { intentId: string; claimed: boolean }

const ambientIntent = new AsyncLocalStorage<AmbientIntent>()

/**
 * The intent id on a request, or null when it carries none. Throws 400
 * `invalid_intent_id` for a header that is present but not a UUID: a client
 * that meant to deduplicate must learn that it did not.
 */
export function parseIntentHeader(request: Request): string | null {
  const raw = request.headers.get(INTENT_HEADER)
  if (raw === null || raw.trim() === "") return null
  const parsed = intentIdSchema.safeParse(raw.trim())
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_intent_id",
      `${INTENT_HEADER} must be a UUID.`
    )
  }
  return parsed.data.toLowerCase()
}

/** Runs `fn` with `intentId` as the request's ambient intent (null: none). */
export function withMutationIntent<T>(intentId: string | null, fn: () => T): T {
  if (!intentId) return fn()
  return ambientIntent.run({ intentId, claimed: false }, fn)
}

/** The ambient intent id, without claiming it. */
export function currentIntentId(): string | null {
  return ambientIntent.getStore()?.intentId ?? null
}

/**
 * Takes the ambient intent for one operation. Only the FIRST write of a
 * request records a receipt under it: the unique (organisation, intent) key
 * would otherwise turn a route's second write into a false intent_conflict.
 */
export function claimAmbientIntent(): string | null {
  const store = ambientIntent.getStore()
  if (!store || store.claimed) return null
  store.claimed = true
  return store.intentId
}

/**
 * The per-request part of a request-scoped idempotency key (media, place
 * actions, post deletes, business information). With an intent it is the
 * intent, so a retry of the same intent derives the same attempt key and
 * replays it instead of writing again; without one it is the request id, as
 * before.
 */
export function requestScopedKeyPart(requestId: string): string {
  const intentId = currentIntentId()
  return intentId ? `intent:${intentId}` : requestId
}

// ---------------------------------------------------------------------------
// Ledger rows
// ---------------------------------------------------------------------------

/** What a surface says about one write; everything but the hash is for receipts. */
export type OperationDescriptor = {
  /** e.g. "hours", "profile", "local_post" */
  surface: string
  /** e.g. "publish", "create", "delete" */
  action: string
  locationId?: string | null
  targetType?: string | null
  targetRef?: string | null
  /**
   * What makes two requests "the same write" for this intent. Defaults to
   * the attempt's idempotency key.
   */
  payloadHash?: string
  expectedRevision?: string | number | null
  /** The connection the write uses; its credential generation is recorded. */
  googleConnectionId?: string | null
  approvalRef?: string | null
  securityVersion?: number | null
}

export type MutationOperation = {
  id: string
  intentId: string
  surface: string
  action: string
  payloadHash: string
  state: OperationOutcome
  attemptTable: string | null
  attemptId: string | null
  errorCode: string | null
  receipt: StoredReceipt | null
}

/** The jsonb `receipt` column. */
export type StoredReceipt = {
  attemptId?: string | null
  attemptStatus?: string | null
  rawStatus?: string | null
  httpStatus?: number | null
  message?: string | null
}

const operationColumns = (sql: TransactionSql) => sql`
  id::text as id,
  intent_id::text as "intentId",
  surface,
  action,
  payload_hash as "payloadHash",
  state,
  attempt_table as "attemptTable",
  attempt_id::text as "attemptId",
  error_code as "errorCode",
  receipt
`

export function intentConflict(): ApiError {
  return new ApiError(
    409,
    "intent_conflict",
    "This request reuses an intent id that was sent with different content. Start a new request."
  )
}

/**
 * Records the intent, or returns the receipt already recorded for it. Throws
 * 409 `intent_conflict` when the intent was recorded for a different write.
 * Runs in the caller's tenant transaction.
 */
export async function beginOperation(
  sql: TransactionSql,
  input: {
    organisationId: string
    intentId: string
    actorUserId: string
    descriptor: OperationDescriptor
    payloadHash: string
    attemptTable: string | null
  }
): Promise<{ operation: MutationOperation; created: boolean }> {
  const d = input.descriptor
  const connectionId = d.googleConnectionId ?? null
  const [inserted] = await sql<MutationOperation[]>`
    insert into mutation_operation (
      organisation_id, intent_id, actor_user_id, surface, action,
      location_id, target_type, target_ref, payload_hash, expected_revision,
      approval_ref, security_version, google_connection_id,
      connection_generation, attempt_table, state
    )
    values (
      ${input.organisationId}, ${input.intentId}, ${input.actorUserId},
      ${d.surface}, ${d.action}, ${d.locationId ?? null},
      ${d.targetType ?? null}, ${d.targetRef ?? null}, ${input.payloadHash},
      ${d.expectedRevision === undefined || d.expectedRevision === null ? null : String(d.expectedRevision)},
      ${d.approvalRef ?? null}, ${d.securityVersion ?? null}, ${connectionId},
      (select credential_generation from google_connection where id = ${connectionId}),
      ${input.attemptTable}, 'sent'
    )
    on conflict (organisation_id, intent_id) do nothing
    returning ${operationColumns(sql)}
  `
  if (inserted) return { operation: inserted, created: true }
  // Claimed already: by an earlier request, or by a concurrent one whose
  // transaction has committed (the unique index would still block us
  // otherwise).
  const [existing] = await sql<MutationOperation[]>`
    select ${operationColumns(sql)}
    from mutation_operation
    where organisation_id = ${input.organisationId}
      and intent_id = ${input.intentId}
  `
  if (
    !existing ||
    existing.surface !== d.surface ||
    existing.action !== d.action ||
    existing.payloadHash !== input.payloadHash
  ) {
    throw intentConflict()
  }
  return { operation: existing, created: false }
}

/** Points a receipt at the attempt row that carries its write. */
export async function linkOperationAttempt(
  sql: TransactionSql,
  input: { operationId: string; attemptTable: string | null; attemptId: string }
): Promise<void> {
  await sql`
    update mutation_operation
    set attempt_table = ${input.attemptTable},
      attempt_id = ${input.attemptId},
      updated_at = now()
    where id = ${input.operationId}
  `
}

/**
 * Settles every receipt still `sent` for one attempt: this request's own
 * and any that an interrupted earlier request left behind on the same row.
 */
export async function settleOperationsForAttempt(
  sql: TransactionSql,
  input: {
    organisationId: string
    attemptTable: string | null
    attemptId: string
    state: OperationOutcome
    errorCode: string | null
    receipt: StoredReceipt
  }
): Promise<void> {
  if (!input.attemptTable) return
  await sql`
    update mutation_operation
    set state = ${input.state},
      error_code = ${input.errorCode},
      receipt = ${jsonColumn(sql, input.receipt)},
      updated_at = now()
    where organisation_id = ${input.organisationId}
      and attempt_table = ${input.attemptTable}
      and attempt_id = ${input.attemptId}
      and state = 'sent'
  `
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/**
 * The outcome of a settled-successful attempt: `confirmed_applied` only when
 * a readback proved it; a write Google merely accepted is
 * `awaiting_confirmation`.
 */
export function successOutcome(readbackVerified: boolean): OperationOutcome {
  return readbackVerified ? "confirmed_applied" : "awaiting_confirmation"
}

/**
 * The outcome of a failed or ambiguous attempt. `rejected` is Google
 * answering and refusing the change (a 4xx other than auth, timeout and rate
 * limiting); anything else that did not apply is `failed`.
 */
export function failureOutcome(
  status: "failed" | "ambiguous",
  error: unknown
): OperationOutcome {
  if (status === "ambiguous") return "uncertain"
  if (
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    ![401, 408, 429].includes(error.status) &&
    !error.reconnectRequired &&
    isProviderRefusalCode(error.code)
  ) {
    return "rejected"
  }
  return "failed"
}

/**
 * The transport (lib/server/google/transport.ts) raises Google's own refusals
 * with Google's status string as the code (INVALID_ARGUMENT,
 * FAILED_PRECONDITION, ...), or `google_api_error` when the body names none,
 * while the app's own 4xx gates use other snake_case codes. Only the former
 * is Google refusing the change.
 */
function isProviderRefusalCode(code: string): boolean {
  return code === "google_api_error" || /^[A-Z][A-Z_]+$/.test(code)
}

/** The outcome an attempt row's canonical status stands for. */
export function outcomeForAttemptStatus(
  status: string,
  readbackVerified: boolean
): OperationOutcome {
  if (status === "succeeded") return successOutcome(readbackVerified)
  if (status === "failed") return "failed"
  if (status === "ambiguous") return "uncertain"
  return "sent"
}

/** The ApiError a settled failure receipt answers with on a replay. */
export function receiptError(operation: MutationOperation): ApiError {
  const receipt = operation.receipt ?? {}
  const status =
    typeof receipt.httpStatus === "number" &&
    receipt.httpStatus >= 400 &&
    receipt.httpStatus < 600
      ? receipt.httpStatus
      : operation.state === "uncertain"
        ? 502
        : 409
  return new ApiError(
    status,
    operation.errorCode ?? "mutation_failed",
    receipt.message ??
      (operation.state === "uncertain"
        ? "Google did not confirm whether this change was applied."
        : "This change was not applied."),
    { details: { operationId: operation.id, outcome: operation.state } }
  )
}

/** The receipt fields a thrown error contributes. */
export function errorReceipt(
  error: unknown
): Pick<StoredReceipt, "httpStatus" | "message"> {
  if (error instanceof ApiError) {
    return { httpStatus: error.status, message: error.message.slice(0, 500) }
  }
  return { httpStatus: null, message: null }
}

// ---------------------------------------------------------------------------
// Receipt reads
// ---------------------------------------------------------------------------

type ReceiptRow = Omit<MutationReceipt, "createdAt" | "updatedAt"> & {
  actorUserId: string | null
  createdAt: Date
  updatedAt: Date
}

const RECEIPT_NOT_FOUND = {
  code: "mutation_not_found",
  message: "No change with this id was found.",
}

/**
 * One receipt by operation id or intent id, as the session may see it: a
 * receipt for a location follows that location's visibility; one whose
 * location is gone is visible to its actor and to owners and admins. Both
 * misses are the same 404.
 */
export async function loadMutationReceipt(
  sql: TransactionSql,
  session: GrantScope & { organisationId: string },
  id: string
): Promise<MutationReceipt> {
  const [row] = await sql<ReceiptRow[]>`
    select
      id::text as id,
      intent_id::text as "intentId",
      surface,
      action,
      location_id::text as "locationId",
      target_type as "targetType",
      target_ref as "targetRef",
      state as outcome,
      error_code as "errorCode",
      attempt_id::text as "attemptId",
      actor_user_id::text as "actorUserId",
      created_at as "createdAt",
      updated_at as "updatedAt"
    from mutation_operation
    where organisation_id = ${session.organisationId}
      and (id = ${id} or intent_id = ${id})
    order by (id = ${id}) desc
    limit 1
  `
  if (!row) {
    throw new ApiError(404, RECEIPT_NOT_FOUND.code, RECEIPT_NOT_FOUND.message)
  }
  if (row.locationId) {
    await requireLocationAccess(sql, session, row.locationId, RECEIPT_NOT_FOUND)
  } else if (
    row.actorUserId !== session.userId &&
    session.role !== "owner" &&
    session.role !== "admin"
  ) {
    throw new ApiError(404, RECEIPT_NOT_FOUND.code, RECEIPT_NOT_FOUND.message)
  }
  return {
    id: row.id,
    intentId: row.intentId,
    surface: row.surface,
    action: row.action,
    locationId: row.locationId,
    targetType: row.targetType,
    targetRef: row.targetRef,
    outcome: row.outcome,
    errorCode: row.errorCode,
    attemptId: row.attemptId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
