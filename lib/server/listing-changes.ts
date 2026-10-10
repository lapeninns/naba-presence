import "server-only"

import { randomUUID } from "node:crypto"

import type { TransactionSql } from "postgres"
import type { ZodType } from "zod"

import {
  LISTING_CHANGE_LABEL,
  type ListingChangeKind,
  type ListingChangeParkedResponse,
  type ListingChangeRequest,
} from "@/lib/contracts/listing-changes"
import type { OperationOutcome } from "@/lib/contracts/mutation-operations"
import { writeAudit } from "@/lib/server/audit"
import { jsonColumn, withTenant } from "@/lib/server/db"
import type { GbpWriteSurface } from "@/lib/server/env"
import { idempotencyKey, type IdempotencyPart } from "@/lib/server/gbp-write"
import { ApiError } from "@/lib/server/http"
import {
  claimAmbientIntent,
  currentIntentId,
  errorReceipt,
  intentConflict,
  withMutationIntent,
  type StoredReceipt,
} from "@/lib/server/mutation-operations"
import { isOrgFeatureEnabled } from "@/lib/server/org-features"
import { requireGbpDispatch } from "@/lib/server/pause-controls"
import {
  canPublishLocation,
  requireLocationAccess,
  requireLocationAction,
} from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

/**
 * Two-person approval for direct listing writes (plan P02-S2b;
 * supabase/migrations/0075_listing_change_approval.sql).
 *
 * With the organisation's `require_two_person_approval` on AND its
 * `listing_change_approvals` feature switched on (organisation_feature), a
 * publisher's write to Google from a listing editor is not dispatched. It is
 * frozen as a change request -- a mutation_operation receipt in state
 * `awaiting_approval` holding the exact validated body, its payload hash, the
 * fields it writes, the baseline it was edited against and its author -- and
 * the route answers 202. A different publisher approves that exact request
 * (naming its payload hash), and the approval dispatches the frozen body
 * through the surface's own write function, so through runGbpWrite and every
 * check it makes, as the approver. Policy or feature off: nothing here runs
 * and the write behaves exactly as before.
 *
 * What makes a request stale:
 *   - a newer request for the same change (same kind, location and target)
 *     supersedes it (`approval_superseded`);
 *   - a local save of the content it publishes (hours, profile, menus)
 *     invalidates it (`approval_invalidated`);
 *   - anything else that moved -- Google's copy, the saved revision -- is
 *     caught at dispatch by the surface's own freshness check against the
 *     frozen baseline, which refuses with its usual 409 and settles the
 *     request `failed` with that code. Nothing is ever sent from a stale
 *     baseline.
 *
 * After approval the request follows its dispatch: it is linked to the
 * dispatch's attempt row and takes its receipt's state, so the attempt's
 * settle (or the `mutation_recover` job, for an uncertain one) settles the
 * change request with it.
 *
 * A non-publisher's write is not parked: the surface refuses it as before.
 * Approvals record no MFA assurance yet; P02-S9 adds that to the decision.
 */

export const LISTING_CHANGE_FEATURE = "listing_change_approvals" as const

/** One kind of listing write that can park, and how to send it later. */
export type ListingChangeEntry<TBody = unknown, TResult = unknown> = {
  kind: ListingChangeKind
  /** The receipt surface its write records (runGbpWrite `operation.surface`). */
  surface: string
  /** The dispatch pause gate to check before an approval is recorded. */
  gbpSurface: GbpWriteSurface
  /** The receipt action its write records. */
  action: (body: TBody) => string
  /** The route's body schema; the frozen body is re-validated at dispatch. */
  body: ZodType<TBody>
  /** The fields the change writes, shown to the approver. */
  fieldMask: (body: TBody) => string[]
  /** The baseline the author edited against, if the body names one. */
  expectedRevision: (body: TBody) => string | null
  /** The surface's own write: what the route does when nothing parks it. */
  dispatch: (input: ListingChangeDispatch<TBody>) => Promise<TResult>
}

export type ListingChangeDispatch<TBody> = {
  session: Session
  locationId: string
  /** The media item or booking link the change is about. */
  target: string | null
  body: TBody
  requestId: string
}

export type ListingChangeSubmit<TBody> = Omit<
  ListingChangeDispatch<TBody>,
  "target"
> & {
  target?: string | null
}

/** The frozen request, as stored in mutation_operation.change_request. */
type FrozenChange = {
  kind: ListingChangeKind
  target: string | null
  body: unknown
}

const PARKED_NOT_FOUND = {
  code: "change_request_not_found",
  message: "This change request was not found.",
}

function payloadHashOf(
  kind: ListingChangeKind,
  locationId: string,
  target: string | null,
  body: unknown
): string {
  return idempotencyKey([
    "listing_change",
    kind,
    locationId,
    target,
    body as IdempotencyPart,
  ])
}

/**
 * Whether a publisher's listing write at this location must park: the
 * organisation's two-person policy and the feature are both on. Runs in the
 * caller's tenant transaction.
 */
export async function listingApprovalRequired(
  sql: TransactionSql,
  organisationId: string
): Promise<boolean> {
  const [org] = await sql<{ twoPerson: boolean }[]>`
    select require_two_person_approval as "twoPerson"
    from organisation
    where id = ${organisationId}
  `
  if (!org?.twoPerson) return false
  return isOrgFeatureEnabled(sql, organisationId, LISTING_CHANGE_FEATURE)
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type ChangeRow = {
  id: string
  intentId: string
  locationId: string | null
  surface: string
  action: string
  payloadHash: string
  state: OperationOutcome
  errorCode: string | null
  changeRequest: FrozenChange
  fieldMask: string[] | null
  actorUserId: string | null
  authorName: string | null
  approvalRef: string | null
  createdAt: Date
  updatedAt: Date
}

const changeColumns = (sql: TransactionSql) => sql`
  o.id::text as id,
  o.intent_id::text as "intentId",
  o.location_id::text as "locationId",
  o.surface,
  o.action,
  o.payload_hash as "payloadHash",
  o.state,
  o.error_code as "errorCode",
  o.change_request as "changeRequest",
  o.field_mask as "fieldMask",
  o.actor_user_id::text as "actorUserId",
  u.display_name as "authorName",
  o.approval_ref as "approvalRef",
  o.created_at as "createdAt",
  o.updated_at as "updatedAt"
`

function toWire(
  row: ChangeRow,
  viewer: { userId: string; canDecide: boolean }
): ListingChangeRequest {
  const isOwn = row.actorUserId === viewer.userId
  const kind = row.changeRequest.kind
  return {
    id: row.id,
    intentId: row.intentId,
    kind,
    label: LISTING_CHANGE_LABEL[kind] ?? kind,
    locationId: row.locationId,
    target: row.changeRequest.target ?? null,
    fieldMask: row.fieldMask ?? [],
    payloadHash: row.payloadHash,
    outcome: row.state,
    errorCode: row.errorCode,
    author: { id: row.actorUserId, name: row.authorName },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isOwn,
    canDecide: viewer.canDecide && !isOwn && row.state === "awaiting_approval",
  }
}

async function loadChange(
  sql: TransactionSql,
  organisationId: string,
  where: { id: string } | { intentId: string },
  options: { lock?: boolean } = {}
): Promise<ChangeRow | null> {
  const filter =
    "id" in where
      ? sql`o.id = ${where.id}`
      : sql`o.intent_id = ${where.intentId}`
  // `for update of o`: the author join must not lock the user row.
  const lock = options.lock ? sql`for update of o` : sql``
  const [row] = await sql<ChangeRow[]>`
    select ${changeColumns(sql)}
    from mutation_operation o
    left join app_user u on u.id = o.actor_user_id
    where o.organisation_id = ${organisationId}
      and ${filter}
      and o.change_request is not null
    ${lock}
  `
  return row ?? null
}

function parkedAnswer(
  row: ChangeRow,
  session: Session
): ListingChangeParkedResponse {
  return {
    status: "awaiting_approval",
    changeRequest: toWire(row, { userId: session.userId, canDecide: false }),
    operation: { operationId: row.id, outcome: row.state },
  }
}

// ---------------------------------------------------------------------------
// Parking
// ---------------------------------------------------------------------------

/**
 * Parks the write as a change request when approval is required, and returns
 * the 202 answer; null means "send it as before". A retry of the same intent
 * gets the request it already parked (whatever the policy says now), and the
 * same intent with a different body is a 409 `intent_conflict`.
 */
export async function parkListingChange<TBody>(
  entry: ListingChangeEntry<TBody, unknown>,
  input: ListingChangeSubmit<TBody>
): Promise<ListingChangeParkedResponse | null> {
  const { session, locationId, body } = input
  const target = input.target ?? null
  const payloadHash = payloadHashOf(entry.kind, locationId, target, body)
  const ambient = currentIntentId()
  return withTenant(session.organisationId, async (sql) => {
    if (ambient) {
      const replay = await loadChange(sql, session.organisationId, {
        intentId: ambient,
      })
      if (replay) {
        if (replay.payloadHash !== payloadHash) throw intentConflict()
        claimAmbientIntent()
        return parkedAnswer(replay, session)
      }
    }
    if (!(await listingApprovalRequired(sql, session.organisationId))) {
      return null
    }
    // A member who may not publish here is refused by the surface itself,
    // exactly as before; only a publisher's write is held for a second one.
    if (!(await canPublishLocation(sql, session, locationId))) return null

    const intentId = claimAmbientIntent() ?? randomUUID()
    const frozen: FrozenChange = { kind: entry.kind, target, body }
    const [inserted] = await sql<{ id: string }[]>`
      insert into mutation_operation (
        organisation_id, intent_id, actor_user_id, surface, action,
        location_id, target_type, target_ref, payload_hash, expected_revision,
        state, change_request, field_mask
      )
      values (
        ${session.organisationId}, ${intentId}, ${session.userId},
        ${entry.surface}, ${entry.action(body)}, ${locationId},
        'listing_change', ${target}, ${payloadHash},
        ${truncate(entry.expectedRevision(body), 256)},
        'awaiting_approval', ${jsonColumn(sql, frozen)},
        ${entry.fieldMask(body).slice(0, 64)}::text[]
      )
      on conflict (organisation_id, intent_id) do nothing
      returning id::text as id
    `
    if (!inserted) {
      // A concurrent request under the same intent won the insert.
      const winner = await loadChange(sql, session.organisationId, { intentId })
      if (!winner || winner.payloadHash !== payloadHash) throw intentConflict()
      return parkedAnswer(winner, session)
    }
    // The newer request is the one people mean now.
    await sql`
      update mutation_operation
      set state = 'failed', error_code = 'approval_superseded', updated_at = now()
      where organisation_id = ${session.organisationId}
        and location_id = ${locationId}
        and surface = ${entry.surface}
        and state = 'awaiting_approval'
        and change_request ->> 'kind' = ${entry.kind}
        and target_ref is not distinct from ${target}
        and id <> ${inserted.id}
    `
    await writeAudit(sql, {
      organisationId: session.organisationId,
      actorUserId: session.userId,
      action: "listing_change.requested",
      subjectType: "mutation_operation",
      subjectId: inserted.id,
      requestId: input.requestId,
      metadata: {
        locationId,
        kind: entry.kind,
        target,
        fieldMask: entry.fieldMask(body),
      },
    })
    const row = await loadChange(sql, session.organisationId, {
      id: inserted.id,
    })
    if (!row) throw new Error("listing change request vanished after insert")
    return parkedAnswer(row, session)
  })
}

function truncate(value: string | null, max: number): string | null {
  return value === null ? null : value.slice(0, max)
}

/**
 * Withdraws the pending requests of `kinds` at a location because the
 * content they would publish was edited locally: the approver would be
 * approving text that no longer exists. Settles them `failed` with
 * `approval_invalidated`; a no-op when nothing is pending.
 */
export async function invalidatePendingListingChanges(input: {
  organisationId: string
  locationId: string
  kinds: readonly ListingChangeKind[]
}): Promise<number> {
  return withTenant(input.organisationId, async (sql) => {
    const settled = await sql`
      update mutation_operation
      set state = 'failed', error_code = 'approval_invalidated', updated_at = now()
      where organisation_id = ${input.organisationId}
        and location_id = ${input.locationId}
        and state = 'awaiting_approval'
        and change_request ->> 'kind' = any(${input.kinds as string[]}::text[])
      returning id
    `
    return settled.length
  })
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The pending change requests at one location, oldest first. */
export async function listListingChanges(
  session: Session,
  locationId: string
): Promise<ListingChangeRequest[]> {
  return withTenant(session.organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId, {
      code: "location_not_found",
      message: "Location not found.",
    })
    const canDecide =
      session.role !== "viewer" &&
      (await canPublishLocation(sql, session, locationId))
    const rows = await sql<ChangeRow[]>`
      select ${changeColumns(sql)}
      from mutation_operation o
      left join app_user u on u.id = o.actor_user_id
      where o.organisation_id = ${session.organisationId}
        and o.location_id = ${locationId}
        and o.state = 'awaiting_approval'
        and o.change_request is not null
      order by o.created_at, o.id
      limit 100
    `
    return rows.map((row) => toWire(row, { userId: session.userId, canDecide }))
  })
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export type ListingChangeDecision = {
  session: Session
  locationId: string
  changeId: string
  decision: "approve" | "reject"
  payloadHash: string
  requestId: string
}

export type ListingChangeDecided = {
  changeRequest: ListingChangeRequest
}

function notPending(): ApiError {
  return new ApiError(
    409,
    "change_request_not_pending",
    "This change is no longer waiting for approval."
  )
}

/**
 * Locks the request and runs the checks approve and reject share: it is this
 * location's, the decider may decide here, it is still pending, and it is
 * the request the decider was shown.
 */
async function lockPending(
  sql: TransactionSql,
  input: ListingChangeDecision
): Promise<ChangeRow> {
  await requireLocationAction(
    sql,
    input.session,
    input.locationId,
    "decide_approval",
    PARKED_NOT_FOUND
  )
  const row = await loadChange(
    sql,
    input.session.organisationId,
    { id: input.changeId },
    { lock: true }
  )
  if (!row || row.locationId !== input.locationId) {
    throw new ApiError(404, PARKED_NOT_FOUND.code, PARKED_NOT_FOUND.message)
  }
  if (row.state !== "awaiting_approval") throw notPending()
  if (row.payloadHash !== input.payloadHash) {
    throw new ApiError(
      409,
      "change_request_changed",
      "This is not the change you were shown. Reload and review it again."
    )
  }
  return row
}

async function insertDecision(
  sql: TransactionSql,
  input: ListingChangeDecision,
  row: ChangeRow,
  decision: "approved" | "rejected"
): Promise<string> {
  const [decided] = await sql<{ id: string }[]>`
    insert into mutation_approval_decision (
      organisation_id, operation_id, payload_hash, requested_by, decided_by,
      decision
    ) values (
      ${input.session.organisationId}, ${row.id}, ${row.payloadHash},
      ${row.actorUserId}, ${input.session.userId}, ${decision}
    )
    returning id::text as id
  `
  return decided.id
}

/**
 * Rejects a pending request, or withdraws it when its author asks. Either
 * way nothing is sent and the request settles `failed`
 * (`approval_rejected` / `approval_withdrawn`). A withdrawal writes no
 * decision row: a decision is by definition somebody else's.
 */
export async function rejectListingChange(
  input: ListingChangeDecision
): Promise<ListingChangeDecided> {
  return withTenant(input.session.organisationId, async (sql) => {
    const row = await lockPending(sql, input)
    const own = row.actorUserId === input.session.userId
    const decisionId = own
      ? null
      : await insertDecision(sql, input, row, "rejected")
    await sql`
      update mutation_operation
      set state = 'failed',
        error_code = ${own ? "approval_withdrawn" : "approval_rejected"},
        approval_ref = ${decisionId},
        updated_at = now()
      where id = ${row.id}
    `
    await writeAudit(sql, {
      organisationId: input.session.organisationId,
      actorUserId: input.session.userId,
      action: own ? "listing_change.withdrawn" : "listing_change.rejected",
      subjectType: "mutation_operation",
      subjectId: row.id,
      requestId: input.requestId,
      metadata: {
        locationId: input.locationId,
        kind: row.changeRequest.kind,
        decisionId,
      },
    })
    const after = await loadChange(sql, input.session.organisationId, {
      id: row.id,
    })
    return {
      changeRequest: toWire(after ?? row, {
        userId: input.session.userId,
        canDecide: true,
      }),
    }
  })
}

/**
 * Approves a pending request and dispatches it, as the approver, through
 * the surface's own write. The decision commits before the dispatch (so a
 * failed send keeps the record of who approved what); the dispatch's own
 * errors -- a stale baseline's 409, Google refusing, a pause -- are rethrown
 * after the request has been settled from them.
 */
export async function approveListingChange<TBody, TResult>(
  entry: ListingChangeEntry<TBody, TResult>,
  input: ListingChangeDecision
): Promise<ListingChangeDecided & { result: TResult }> {
  const organisationId = input.session.organisationId
  const dispatchIntentId = randomUUID()
  const approved = await withTenant(organisationId, async (sql) => {
    const row = await lockPending(sql, input)
    if (row.actorUserId === input.session.userId) {
      throw new ApiError(
        403,
        "listing_second_approver_required",
        "A different publisher must approve this change."
      )
    }
    // The dispatch gate itself (env and operator pause table): a pause
    // refuses here, before a decision claims the change was sent.
    await requireGbpDispatch(entry.gbpSurface)
    const decisionId = await insertDecision(sql, input, row, "approved")
    await sql`
      update mutation_operation
      set state = 'sent',
        approval_ref = ${decisionId},
        receipt = ${jsonColumn(sql, { dispatchIntentId })},
        updated_at = now()
      where id = ${row.id}
    `
    await writeAudit(sql, {
      organisationId,
      actorUserId: input.session.userId,
      action: "listing_change.approved",
      subjectType: "mutation_operation",
      subjectId: row.id,
      requestId: input.requestId,
      metadata: {
        locationId: input.locationId,
        kind: row.changeRequest.kind,
        decisionId,
        authorId: row.actorUserId,
      },
    })
    return row
  })

  const settle = (fallback: {
    state: OperationOutcome
    errorCode: string | null
    receipt: StoredReceipt
  }) =>
    withTenant(organisationId, (sql) =>
      followDispatch(sql, {
        organisationId,
        changeId: approved.id,
        dispatchIntentId,
        fallback,
      })
    )

  let result: TResult
  try {
    const parsed = entry.body.safeParse(approved.changeRequest.body)
    if (!parsed.success) {
      throw new ApiError(
        409,
        "change_request_invalid",
        "This change can no longer be sent as it was requested. Make it again."
      )
    }
    result = await withMutationIntent(dispatchIntentId, () =>
      entry.dispatch({
        session: input.session,
        locationId: input.locationId,
        target: approved.changeRequest.target ?? null,
        body: parsed.data,
        requestId: input.requestId,
      })
    )
  } catch (error) {
    await settle({
      state: "failed",
      errorCode: error instanceof ApiError ? error.code : "dispatch_failed",
      receipt: { dispatchIntentId, ...errorReceipt(error) },
    })
    throw error
  }
  await settle({
    state: answeredOutcome(result),
    errorCode: null,
    receipt: { dispatchIntentId },
  })
  const after = await withTenant(organisationId, (sql) =>
    loadChange(sql, organisationId, { id: approved.id })
  )
  return {
    changeRequest: toWire(after ?? approved, {
      userId: input.session.userId,
      canDecide: true,
    }),
    result,
  }
}

/**
 * The outcome a dispatch that recorded no receipt answered with: its own
 * `operation.outcome`, or -- for a publish that found Google already
 * matching -- `confirmed_applied`, since it read Google to say so.
 */
function answeredOutcome(result: unknown): OperationOutcome {
  const answer = (result ?? {}) as {
    status?: unknown
    operation?: { outcome?: OperationOutcome }
  }
  if (answer.operation?.outcome) return answer.operation.outcome
  if (answer.status === "in_sync" || answer.status === "selection_in_sync") {
    return "confirmed_applied"
  }
  return "awaiting_confirmation"
}

/**
 * Points an approved change request at its dispatch: the attempt row the
 * dispatch's receipt is linked to and that receipt's state, so the attempt's
 * settle or recovery settles both. Without a dispatch receipt (refused
 * before any attempt, or a write that sends nothing) the request takes
 * `fallback`. The dispatch receipt carries recovery, so the change request
 * itself is never queued for it.
 */
async function followDispatch(
  sql: TransactionSql,
  input: {
    organisationId: string
    changeId: string
    dispatchIntentId: string
    fallback: {
      state: OperationOutcome
      errorCode: string | null
      receipt: StoredReceipt
    }
  }
): Promise<void> {
  const [dispatch] = await sql<
    {
      id: string
      attemptTable: string | null
      attemptId: string | null
      state: OperationOutcome
      errorCode: string | null
      receipt: StoredReceipt | null
    }[]
  >`
    select
      id::text as id,
      attempt_table as "attemptTable",
      attempt_id::text as "attemptId",
      state,
      error_code as "errorCode",
      receipt
    from mutation_operation
    where organisation_id = ${input.organisationId}
      and intent_id = ${input.dispatchIntentId}
  `
  if (dispatch?.attemptId) {
    await sql`
      update mutation_operation
      set attempt_table = ${dispatch.attemptTable},
        attempt_id = ${dispatch.attemptId},
        state = ${dispatch.state},
        error_code = ${dispatch.errorCode},
        receipt = ${jsonColumn(sql, {
          ...(dispatch.receipt ?? {}),
          dispatchIntentId: input.dispatchIntentId,
          dispatchOperationId: dispatch.id,
        })},
        next_recovery_at = null,
        updated_at = now()
      where id = ${input.changeId}
        and state = 'sent'
    `
    return
  }
  await sql`
    update mutation_operation
    set state = ${input.fallback.state},
      error_code = ${input.fallback.errorCode},
      receipt = ${jsonColumn(sql, input.fallback.receipt)},
      next_recovery_at = null,
      updated_at = now()
    where id = ${input.changeId}
      and state = 'sent'
  `
}

/**
 * A media upload carries the file itself, which a change request cannot
 * freeze (there is no asset store to hold the bytes until an approval;
 * plan P09-S7). While listing approval applies, a publisher's upload is
 * refused instead of being sent unapproved; adding a photo by URL parks as
 * usual.
 */
export async function refuseUploadWhenApprovalRequired(
  session: Session,
  locationId: string
): Promise<void> {
  const refused = await withTenant(session.organisationId, async (sql) =>
    (await listingApprovalRequired(sql, session.organisationId))
      ? canPublishLocation(sql, session, locationId)
      : false
  )
  if (refused) {
    throw new ApiError(
      409,
      "listing_change_upload_unsupported",
      "Uploads can’t be sent for approval yet. Add the photo by its web address instead, or ask an owner to turn two-person approval off."
    )
  }
}
