import "server-only"

/**
 * `publish_attempt` and `publish_attempt_event` row operations: the durable
 * mutation intent, its re-arm for a retry, and the succeeded / failed /
 * retryable / ambiguous settlement of the attempt row itself.
 *
 * This is the reply pipeline's attempt store. It is deliberately not an
 * `AttemptStore` for `runGbpWrite` (lib/server/gbp-write.ts): the table
 * carries `retryable` + `next_attempt_at` + `attempt_no` scheduling that the
 * helper's `AttemptSettleInput` cannot express, and its failure
 * classification (429 -> retryable with back-off) differs from the helper's
 * `classifyFailure` (any non-ambiguous error -> failed). See the module
 * header of lib/server/publishing.ts for the full boundary.
 */

import type { TransactionSql } from "postgres"

import { retryDelayMs } from "@/lib/domain/retry"
import { isAmbiguousProviderError } from "@/lib/server/gbp-write"
import { isConnectionBlockedError } from "@/lib/server/google/connection-failures"
import { ApiError } from "@/lib/server/http"

import type {
  PublishAttemptEventType,
  PublishAttemptOperation,
  PublishAttemptStatus,
} from "./types"

export async function writePublishAttemptEvent(
  sql: TransactionSql,
  input: {
    organisationId: string
    publishAttemptId: string
    eventType: PublishAttemptEventType
    payload?: Record<string, unknown>
  }
) {
  await sql`
    insert into publish_attempt_event (
      organisation_id,
      publish_attempt_id,
      event_type,
      payload
    )
    values (
      ${input.organisationId},
      ${input.publishAttemptId},
      ${input.eventType},
      ${sql.json(JSON.parse(JSON.stringify(input.payload ?? {})))}
    )
  `
}

/** The row `findAttemptByKey` returns for an idempotency key. */
export type ExistingAttempt = {
  id: string
  status: string
  review_reply_id: string
  attempt_no: number
  next_attempt_at: Date | null
}

export type StartedAttempt = { id: string; attempt_no: number }

export async function findAttemptByKey(
  sql: TransactionSql,
  input: { organisationId: string; idempotencyKey: string }
): Promise<ExistingAttempt | null> {
  const [existing] = await sql<ExistingAttempt[]>`
    select
      id::text as id,
      status,
      review_reply_id::text as review_reply_id,
      attempt_no,
      next_attempt_at
    from publish_attempt
    where organisation_id = ${input.organisationId}
      and idempotency_key = ${input.idempotencyKey}
    limit 1
  `
  return existing ?? null
}

/**
 * Re-arm a settled (`retryable`) row as a fresh `started` intent. Publish
 * re-arms also pin the intended body; delete re-arms leave it untouched.
 */
export async function rearmAttempt(
  sql: TransactionSql,
  input: { attemptId: string; intendedBody?: string }
): Promise<StartedAttempt> {
  const [attempt] =
    input.intendedBody === undefined
      ? await sql<StartedAttempt[]>`
          update publish_attempt
          set
            status = 'started',
            attempt_no = attempt_no + 1,
            provider_http_status = null,
            provider_error_code = null,
            provider_error_body = null,
            next_attempt_at = null,
            started_at = now(),
            finished_at = null
          where id = ${input.attemptId}
          returning id::text as id, attempt_no
        `
      : await sql<StartedAttempt[]>`
          update publish_attempt
          set
            status = 'started',
            attempt_no = attempt_no + 1,
            provider_http_status = null,
            provider_error_code = null,
            provider_error_body = null,
            next_attempt_at = null,
            intended_body = ${input.intendedBody},
            started_at = now(),
            finished_at = null
          where id = ${input.attemptId}
          returning id::text as id, attempt_no
        `
  return attempt
}

/**
 * Insert the durable `started` intent (attempt 1) for a reply mutation.
 * Returns null when a concurrent request already inserted this key: the
 * caller re-reads that row and resolves against it, rather than letting the
 * `(organisation_id, idempotency_key)` unique violation surface as a 500.
 */
export async function insertAttempt(
  sql: TransactionSql,
  input: {
    organisationId: string
    reviewReplyId: string
    draftId: string | null
    idempotencyKey: string
    requestBodyHash: string
    operation: PublishAttemptOperation
    intendedBody: string | null
    publishGeneration: number
  }
): Promise<StartedAttempt | null> {
  const [attempt] = await sql<StartedAttempt[]>`
    insert into publish_attempt (
      organisation_id,
      review_reply_id,
      draft_id,
      idempotency_key,
      request_body_hash,
      status,
      attempt_no,
      operation,
      intended_body,
      publish_generation
    )
    values (
      ${input.organisationId},
      ${input.reviewReplyId},
      ${input.draftId},
      ${input.idempotencyKey},
      ${input.requestBodyHash},
      'started',
      1,
      ${input.operation},
      ${input.intendedBody},
      ${input.publishGeneration}
    )
    on conflict (organisation_id, idempotency_key) do nothing
    returning id::text as id, attempt_no
  `
  return attempt ?? null
}

/**
 * Settle the attempt row as `succeeded` after a confirmed provider write.
 * The guard is the status the caller decided against, and the return value
 * says whether this caller made the transition: a settle that lost a race
 * with a concurrent recovery is a no-op instead of a clobber, and its caller
 * must skip the rest of the settlement the winner has already written.
 */
export async function markAttemptSucceeded(
  sql: TransactionSql,
  attemptId: string,
  expectedStatus: PublishAttemptStatus = "started"
): Promise<boolean> {
  const settled = await sql`
    update publish_attempt
    set
      status = 'succeeded',
      provider_http_status = 200,
      provider_error_code = null,
      next_attempt_at = null,
      finished_at = now()
    where id = ${attemptId}
      and status = ${expectedStatus}
    returning id
  `
  return settled.length > 0
}

/**
 * Retire attempts the reply has moved past. Not a provider verdict: nothing
 * was sent, the row keeps its idempotency key and stays re-armable, and it
 * leaves every claim predicate (all allowlists over `retryable` / `ambiguous`
 * / `started`) so the runner can no longer replay it.
 */
export async function supersedeAttempts(
  sql: TransactionSql,
  input: { organisationId: string; attemptIds: string[]; reason: string }
) {
  if (input.attemptIds.length === 0) return
  // Only a still-queued row is ours to retire: one the runner has already
  // claimed is mid-provider-call, and superseding it would leave a write it
  // is about to confirm with nothing to settle against.
  const retired = await sql<{ id: string }[]>`
    update publish_attempt
    set
      status = 'superseded',
      provider_error_code = ${input.reason},
      next_attempt_at = null,
      lease_expires_at = null,
      finished_at = now()
    where id = any(${input.attemptIds}::uuid[])
      and status = 'retryable'
    returning id::text as id
  `
  for (const attempt of retired) {
    await writePublishAttemptEvent(sql, {
      organisationId: input.organisationId,
      publishAttemptId: attempt.id,
      eventType: "completed",
      payload: { result: "superseded", reason: input.reason },
    })
  }
}

/**
 * Supersede every queued sibling of the intent now taking over this reply
 * (`keepAttemptId` is the attempt taking over, if any). A `retryable` row is
 * armed work the runner will replay verbatim, so a newer intent for the same
 * reply has to retire it here rather than refuse to start: refusing would
 * block publishing for as long as the sibling is parked, which for a
 * connection-blocked reply is as long as a human takes to reconnect.
 */
export async function supersedeQueuedSiblings(
  sql: TransactionSql,
  input: {
    organisationId: string
    reviewReplyId: string
    keepAttemptId?: string
    reason: string
  }
) {
  const siblings = await sql<{ id: string }[]>`
    select id::text as id
    from publish_attempt
    where review_reply_id = ${input.reviewReplyId}
      and status = 'retryable'
      and id is distinct from ${input.keepAttemptId ?? null}::uuid
  `
  await supersedeAttempts(sql, {
    organisationId: input.organisationId,
    attemptIds: siblings.map((sibling) => sibling.id),
    reason: input.reason,
  })
}

export type ProviderFailure = {
  /**
   * Attempt-row status: `ambiguous` (unknown), `retryable` (a 429, or a
   * connection that could not issue a token), or `failed`.
   */
  status: "ambiguous" | "retryable" | "failed"
  ambiguous: boolean
  retryable: boolean
  /** True when neither ambiguous nor retryable: the local reply fails too. */
  terminal: boolean
  nextAttemptAt: Date | null
  httpStatus: number | null
  errorCode: string
  error: unknown
}

/**
 * How long a connection-blocked attempt parks. Reconnecting is a human
 * closing a task and a token endpoint recovering is Google's own outage
 * window, so the 500 ms - 30 s provider back-off would only spin the queue
 * against a door that is not going to open inside a tick.
 */
const CONNECTION_BLOCKED_RETRY_MS = 15 * 60 * 1000

/**
 * Ambiguous failures (Google did not confirm) stay distinct from
 * deterministic rejection and are never blindly repeated; only a 429 is
 * scheduled for an automatic retry with exponential back-off.
 *
 * A connection-blocked failure is a third case: the connection layer could
 * not issue a token, so the request never left the building. Treating that
 * as a provider rejection would mark every queued reply permanently `failed`
 * (and its review with it) over a revoked refresh token or a two-second blip
 * on the token endpoint, with nothing to re-arm them once the operator
 * reconnects. It parks on a long back-off instead, and stays non-terminal so
 * the local reply keeps the state it had.
 */
export function classifyProviderFailure(
  error: unknown,
  attemptNo: number
): ProviderFailure {
  const ambiguous = isAmbiguousProviderError(error)
  const connectionBlocked = !ambiguous && isConnectionBlockedError(error)
  const retryable =
    connectionBlocked || (error instanceof ApiError && error.status === 429)
  const status = ambiguous ? "ambiguous" : retryable ? "retryable" : "failed"
  return {
    status,
    ambiguous,
    retryable,
    terminal: !ambiguous && !retryable,
    nextAttemptAt: retryable
      ? new Date(
          Date.now() +
            (connectionBlocked
              ? CONNECTION_BLOCKED_RETRY_MS
              : retryDelayMs(attemptNo))
        )
      : null,
    httpStatus: error instanceof ApiError ? error.status : null,
    errorCode: error instanceof ApiError ? error.code : "network_error",
    error,
  }
}

/**
 * Settle the attempt row after a failed provider call and append the
 * `retry_scheduled` / `provider_rejected` event. `eventPayload` carries the
 * caller's extra keys (`source`, `operation`).
 */
export async function recordAttemptFailure(
  sql: TransactionSql,
  input: {
    organisationId: string
    attemptId: string
    failure: ProviderFailure
    eventPayload?: Record<string, unknown>
  }
) {
  const { failure } = input
  await sql`
    update publish_attempt
    set
      status = ${failure.status},
      provider_http_status = ${failure.httpStatus},
      provider_error_code = ${failure.errorCode},
      next_attempt_at = ${failure.nextAttemptAt},
      finished_at = now()
    where id = ${input.attemptId}
  `
  await writePublishAttemptEvent(sql, {
    organisationId: input.organisationId,
    publishAttemptId: input.attemptId,
    eventType: failure.retryable ? "retry_scheduled" : "provider_rejected",
    payload: {
      ...input.eventPayload,
      code: failure.errorCode,
      nextAttemptAt: failure.nextAttemptAt?.toISOString() ?? null,
    },
  })
}
