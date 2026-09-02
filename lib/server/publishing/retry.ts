import "server-only"

/**
 * `retryPublishAttempt`: the job runner's due-retry path. A `retryable`
 * attempt whose back-off has elapsed is re-claimed as `started` (attempt
 * number incremented), the intended mutation is replayed at Google outside
 * the transaction, and the result settles exactly like an interactive
 * publish/delete minus the request-scoped audit events.
 */

import type { TransactionSql } from "postgres"

import { deleteWorkflowTarget } from "@/lib/domain/workflow"
import { withTenant } from "@/lib/server/db"

import {
  classifyProviderFailure,
  markAttemptSucceeded,
  recordAttemptFailure,
  writePublishAttemptEvent,
} from "./attempt"
import {
  deleteReplyFromGoogle,
  publishReplyToGoogle,
  replyTarget,
  type GoogleReviewReply,
  type ProviderCall,
} from "./provider"
import {
  applyDeletedReply,
  applyFailedReply,
  applyPublishedReply,
  setReviewWorkflow,
} from "./settle"
import type { PublishAttemptOperation, RetryResult } from "./types"

type RetryAttemptContext = {
  id: string
  operation: PublishAttemptOperation
  intendedBody: string | null
  attemptNo: number
  reviewId: string
  reviewReplyId: string
  googleReviewNameCiphertext: Buffer
  connectionId: string
}

const JOB_RUNNER = { source: "job_runner" } as const

/** Claim the due `retryable` row as a new `started` attempt; null when not due. */
async function claimRetry(
  sql: TransactionSql,
  organisationId: string,
  attemptId: string
): Promise<RetryAttemptContext | null> {
  const [claimed] = await sql<{ attemptNo: number }[]>`
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
    where id = ${attemptId}
      and status = 'retryable'
      and next_attempt_at <= now()
    returning attempt_no as "attemptNo"
  `
  if (!claimed) return null
  const [attempt] = await sql<Omit<RetryAttemptContext, "attemptNo">[]>`
    select
      pa.id::text as id,
      pa.operation,
      pa.intended_body as "intendedBody",
      rr.review_id::text as "reviewId",
      rr.id::text as "reviewReplyId",
      r.google_review_name_ciphertext as "googleReviewNameCiphertext",
      e.google_connection_id::text as "connectionId"
    from publish_attempt pa
    join review_reply rr on rr.id = pa.review_reply_id
    join review r on r.id = rr.review_id
    join external_location e on e.id = r.external_location_id
    where pa.id = ${attemptId}
    limit 1
  `
  if (!attempt) {
    throw new Error(`Publish attempt ${attemptId} was not found`)
  }
  await writePublishAttemptEvent(sql, {
    organisationId,
    publishAttemptId: attemptId,
    eventType: "started",
    payload: { attemptNo: claimed.attemptNo, ...JOB_RUNNER },
  })
  return { ...attempt, attemptNo: claimed.attemptNo }
}

/** Replay the intended mutation. A publish row without a body is a failure, not a throw. */
async function replayAtGoogle(
  organisationId: string,
  context: RetryAttemptContext
): Promise<ProviderCall<GoogleReviewReply | Record<string, never>>> {
  const target = replyTarget({
    organisationId,
    connectionId: context.connectionId,
    googleReviewNameCiphertext: context.googleReviewNameCiphertext,
  })
  if (context.operation === "delete") return deleteReplyFromGoogle(target)
  if (context.intendedBody === null) {
    return { error: new Error("Publish retry is missing intended_body") }
  }
  return publishReplyToGoogle(target, context.intendedBody)
}

async function settleRetrySuccess(
  sql: TransactionSql,
  organisationId: string,
  context: RetryAttemptContext,
  provider: GoogleReviewReply | Record<string, never>
) {
  if (context.operation === "delete") {
    await applyDeletedReply(sql, context.reviewReplyId)
  } else {
    await applyPublishedReply(sql, context.reviewReplyId, provider)
  }
  await markAttemptSucceeded(sql, context.id)
  await setReviewWorkflow(
    sql,
    context.reviewId,
    context.operation === "delete"
      ? deleteWorkflowTarget("remote")
      : "published"
  )
  await writePublishAttemptEvent(sql, {
    organisationId,
    publishAttemptId: context.id,
    eventType: "provider_accepted",
    payload: { ...JOB_RUNNER },
  })
  await writePublishAttemptEvent(sql, {
    organisationId,
    publishAttemptId: context.id,
    eventType: "completed",
    payload: { ...JOB_RUNNER },
  })
}

async function settleRetryFailure(
  sql: TransactionSql,
  organisationId: string,
  context: RetryAttemptContext,
  error: unknown
) {
  const failure = classifyProviderFailure(error, context.attemptNo)
  await recordAttemptFailure(sql, {
    organisationId,
    attemptId: context.id,
    failure,
    eventPayload: { ...JOB_RUNNER },
  })
  if (failure.terminal) {
    await applyFailedReply(sql, {
      reviewReplyId: context.reviewReplyId,
      reviewId: context.reviewId,
    })
  }
  return failure.status
}

export async function retryPublishAttempt(
  organisationId: string,
  attemptId: string
): Promise<RetryResult> {
  const context = await withTenant(organisationId, (sql) =>
    claimRetry(sql, organisationId, attemptId)
  )
  if (!context) return "skipped"

  const call = await replayAtGoogle(organisationId, context)

  return withTenant<RetryResult>(organisationId, async (sql) => {
    if (call.response !== undefined) {
      await settleRetrySuccess(sql, organisationId, context, call.response)
      return "succeeded"
    }
    return settleRetryFailure(sql, organisationId, context, call.error)
  })
}
