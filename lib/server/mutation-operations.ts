import "server-only"

import { AsyncLocalStorage } from "node:async_hooks"

import type { TransactionSql } from "postgres"

import {
  INTENT_HEADER,
  intentIdSchema,
  type MutationReceipt,
  type OperationOutcome,
  type OperationSummary,
} from "@/lib/contracts/mutation-operations"
import { jsonColumn } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import {
  requireLocationAccess,
  type GrantScope,
} from "@/lib/server/permissions"

/**
 * The mutation operation ledger (supabase/migrations/0086_mutation_operation.sql):
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

type AmbientIntent = {
  intentId: string
  claimed: boolean
  /**
   * Receipts that follow this intent's write (an approved listing change
   * request, lib/server/listing-changes.ts): linked to its attempt row in the
   * same transaction that links the intent's own receipt, so whatever
   * settles that attempt -- this request, a reaper, recovery -- settles them
   * too, even if this request never finishes.
   */
  followers?: readonly string[]
}

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

/**
 * Runs `fn` with `intentId` as the request's ambient intent (null: none).
 * `followers` are receipt ids linked to the attempt the intent's write uses
 * (see AmbientIntent).
 */
export function withMutationIntent<T>(
  intentId: string | null,
  fn: () => T,
  options: { followers?: readonly string[] } = {}
): T {
  if (!intentId) return fn()
  return ambientIntent.run(
    { intentId, claimed: false, followers: options.followers },
    fn
  )
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
 * The per-request part of a request-scoped idempotency key (media and post
 * deletes). With an intent it is the intent, so a retry of the same intent
 * derives the same attempt key and replays it instead of writing again;
 * without one it is the request id, as before.
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
  /**
   * An approved listing change request (lib/server/listing-changes.ts): the
   * intent its dispatch ran under, and that dispatch's own receipt.
   */
  dispatchIntentId?: string | null
  dispatchOperationId?: string | null
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

/**
 * Points a receipt at the attempt row that carries its write, and -- when it
 * is the ambient intent's own receipt -- that intent's followers still
 * waiting on a write (`sent`, unlinked).
 */
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
  const store = ambientIntent.getStore()
  if (!store?.followers?.length) return
  await sql`
    update mutation_operation f
    set attempt_table = ${input.attemptTable},
      attempt_id = ${input.attemptId},
      updated_at = now()
    where f.id = any(${store.followers as string[]}::uuid[])
      and f.state = 'sent'
      and f.attempt_id is null
      and exists (
        select 1 from mutation_operation o
        where o.id = ${input.operationId}
          and o.intent_id = ${store.intentId}
          and o.organisation_id = f.organisation_id
      )
  `
}

/**
 * How long after a write turns `uncertain` the recovery job (job kind
 * `mutation_recover`, lib/server/mutation-recovery.ts) first reads Google
 * back. Not at once: a PATCH that timed out may still be applying, and a
 * readback taken too early would call a write that is about to land
 * "not applied".
 */
export const RECOVERY_FIRST_DELAY_SECONDS = 120

/**
 * The `next_recovery_at` an outcome sets: settling into `uncertain` enqueues
 * the receipt for recovery; any other outcome takes it off the queue.
 */
function recoveryDue(
  sql: TransactionSql,
  state: OperationOutcome,
  recoverAfterSeconds = RECOVERY_FIRST_DELAY_SECONDS
) {
  return state === "uncertain"
    ? sql`next_recovery_at = now() + make_interval(secs => ${Math.max(0, recoverAfterSeconds)})`
    : sql`next_recovery_at = null`
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
    /** When an `uncertain` receipt is first read back; see `recoveryDue`. */
    recoverAfterSeconds?: number
  }
): Promise<MutationOperation[]> {
  if (!input.attemptTable) return []
  return sql<MutationOperation[]>`
    update mutation_operation
    set state = ${input.state},
      error_code = ${input.errorCode},
      receipt = ${jsonColumn(sql, input.receipt)},
      ${recoveryDue(sql, input.state, input.recoverAfterSeconds)},
      updated_at = now()
    where organisation_id = ${input.organisationId}
      and attempt_table = ${input.attemptTable}
      and attempt_id = ${input.attemptId}
      and state = 'sent'
    returning ${operationColumns(sql)}
  `
}

/**
 * The bulk form for paths that settle attempt rows without runGbpWrite: the
 * retention cron's stranded-attempt reapers and the stranded local-post
 * sweep (lib/server/posts.ts). Without it a receipt linked to a reaped row
 * would stay `sent` for good. Runs in the caller's tenant transaction, whose
 * RLS scopes it to that organisation.
 */
export async function settleOperationsForAttempts(
  sql: TransactionSql,
  input: {
    attemptTable: string
    attemptIds: readonly string[]
    state: OperationOutcome
    attemptStatus: string
    errorCode: string | null
    /** When an `uncertain` receipt is first read back; see `recoveryDue`. */
    recoverAfterSeconds?: number
  }
): Promise<number> {
  if (input.attemptIds.length === 0) return 0
  const settled = await sql`
    update mutation_operation
    set state = ${input.state},
      error_code = ${input.errorCode},
      receipt = jsonb_build_object(
        'attemptId', attempt_id::text,
        'attemptStatus', ${input.attemptStatus}::text,
        'rawStatus', ${input.attemptStatus}::text
      ),
      ${recoveryDue(sql, input.state, input.recoverAfterSeconds)},
      updated_at = now()
    where attempt_table = ${input.attemptTable}
      and attempt_id = any(${input.attemptIds as string[]}::uuid[])
      and state = 'sent'
    returning id
  `
  return settled.length
}

// ---------------------------------------------------------------------------
// Recovery (job kind `mutation_recover`, lib/server/mutation-recovery.ts)
// ---------------------------------------------------------------------------

/** An uncertain receipt as the recovery job reads it. */
export type RecoveryOperation = {
  id: string
  organisationId: string
  surface: string
  action: string
  actorUserId: string | null
  locationId: string | null
  targetRef: string | null
  googleConnectionId: string | null
  attemptTable: string | null
  attemptId: string | null
  recoveryAttempts: number
  createdAt: Date
}

/** The receipt, while it is still `uncertain`; null once anything settled it. */
export async function loadUncertainOperation(
  sql: TransactionSql,
  operationId: string
): Promise<RecoveryOperation | null> {
  const [row] = await sql<RecoveryOperation[]>`
    select
      id::text as id,
      organisation_id::text as "organisationId",
      surface,
      action,
      actor_user_id::text as "actorUserId",
      location_id::text as "locationId",
      target_ref as "targetRef",
      google_connection_id::text as "googleConnectionId",
      attempt_table as "attemptTable",
      attempt_id::text as "attemptId",
      recovery_attempts as "recoveryAttempts",
      created_at as "createdAt"
    from mutation_operation
    where id = ${operationId}
      and state = 'uncertain'
  `
  return row ?? null
}

/**
 * Settles every receipt waiting on one attempt once recovery has read the
 * provider: `sent` ones (an interrupted request's) and `uncertain` ones
 * (this job's own and any other intent that joined the row). They share the
 * attempt, so they share its truth.
 */
export async function settleRecoveredOperations(
  sql: TransactionSql,
  input: {
    attemptTable: string
    attemptId: string
    state: OperationOutcome
    errorCode: string | null
    receipt: StoredReceipt
  }
): Promise<number> {
  const settled = await sql`
    update mutation_operation
    set state = ${input.state},
      error_code = ${input.errorCode},
      receipt = ${jsonColumn(sql, input.receipt)},
      next_recovery_at = null,
      lease_expires_at = null,
      updated_at = now()
    where attempt_table = ${input.attemptTable}
      and attempt_id = ${input.attemptId}
      and state in ('sent', 'uncertain')
    returning id
  `
  return settled.length
}

/**
 * Puts an uncertain receipt back on the queue. `countAttempt` spends one of
 * its readbacks (an unreadable provider); a park or a row another request
 * holds does not.
 */
export async function rescheduleRecovery(
  sql: TransactionSql,
  input: {
    operationId: string
    at: Date
    errorCode: string
    countAttempt: boolean
  }
): Promise<void> {
  await sql`
    update mutation_operation
    set next_recovery_at = ${input.at},
      lease_expires_at = null,
      error_code = ${input.errorCode},
      recovery_attempts = recovery_attempts + ${input.countAttempt ? 1 : 0},
      updated_at = now()
    where id = ${input.operationId}
      and state = 'uncertain'
  `
}

/**
 * Stops recovering a receipt that stays `uncertain`: nothing can establish
 * what Google holds, so a person has to look. The receipt keeps telling the
 * truth (`uncertain`), with `errorCode` saying why recovery stopped; a null
 * next_recovery_at keeps it out of the claim. True when this call stopped it.
 */
export async function abandonRecovery(
  sql: TransactionSql,
  input: { operationId: string; errorCode: string; countAttempt?: boolean }
): Promise<boolean> {
  const stopped = await sql`
    update mutation_operation
    set next_recovery_at = null,
      lease_expires_at = null,
      error_code = ${input.errorCode},
      recovery_attempts = recovery_attempts + ${input.countAttempt ? 1 : 0},
      updated_at = now()
    where id = ${input.operationId}
      and state = 'uncertain'
    returning id
  `
  return stopped.length > 0
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
        : 500
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

/**
 * The receipt fields a thrown error contributes: the status the original
 * request answered with, so a replay answers the same. An error that is not
 * an ApiError reached the client as a 500 (lib/server/http.ts); its message
 * is internal and is not kept.
 */
export function errorReceipt(
  error: unknown
): Pick<StoredReceipt, "httpStatus" | "message"> {
  if (error instanceof ApiError) {
    return { httpStatus: error.status, message: error.message.slice(0, 500) }
  }
  return { httpStatus: 500, message: null }
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

/**
 * The `operation` field a mutation route answers with
 * (lib/contracts/mutation-operations.ts `operationSummarySchema`), from what
 * runGbpWrite returned.
 */
export function operationSummary(result: {
  operationId?: string
  outcome: OperationOutcome
}): OperationSummary {
  return { operationId: result.operationId ?? null, outcome: result.outcome }
}
