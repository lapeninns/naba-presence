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
import { ApiError } from "@/lib/server/http"

import type { PublishAttemptEventType, PublishAttemptOperation } from "./types"

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

/** Insert the durable `started` intent (attempt 1) for a reply mutation. */
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
  }
): Promise<StartedAttempt> {
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
      intended_body
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
      ${input.intendedBody}
    )
    returning id::text as id, attempt_no
  `
  return attempt
}

/** Settle the attempt row as `succeeded` after a confirmed provider write. */
export async function markAttemptSucceeded(
  sql: TransactionSql,
  attemptId: string
) {
  await sql`
    update publish_attempt
    set
      status = 'succeeded',
      provider_http_status = 200,
      provider_error_code = null,
      next_attempt_at = null,
      finished_at = now()
    where id = ${attemptId}
  `
}

export type ProviderFailure = {
  /** Attempt-row status: `ambiguous` (unknown), `retryable` (429), or `failed`. */
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
 * Ambiguous failures (Google did not confirm) stay distinct from
 * deterministic rejection and are never blindly repeated; only a 429 is
 * scheduled for an automatic retry with exponential back-off.
 */
export function classifyProviderFailure(
  error: unknown,
  attemptNo: number
): ProviderFailure {
  const ambiguous = isAmbiguousProviderError(error)
  const retryable = error instanceof ApiError && error.status === 429
  const status = ambiguous ? "ambiguous" : retryable ? "retryable" : "failed"
  return {
    status,
    ambiguous,
    retryable,
    terminal: !ambiguous && !retryable,
    nextAttemptAt: retryable
      ? new Date(Date.now() + retryDelayMs(attemptNo))
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
