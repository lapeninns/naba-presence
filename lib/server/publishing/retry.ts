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
  supersedeAttempts,
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

/** The claim either produced work to replay, or settled the row itself. */
type RetryClaim =
  | { kind: "claimed"; context: RetryAttemptContext }
  | { kind: "settled"; result: RetryResult }

type RetryPrecheck = Omit<RetryAttemptContext, "attemptNo"> & {
  attemptGeneration: number | null
  replyGeneration: number
  restrictedAt: Date | null
  supersededBySuccess: boolean
}

/**
 * A `retryable` row is a mutation pinned at claim time and replayed verbatim
 * on a later tick, so before replaying it the row has to still describe what
 * the reply wants. Two things invalidate it: the reply moved to a new
 * generation (a delete landed, so this attempt targets a reply that no longer
 * exists), or a later attempt on the same reply already succeeded (the
 * operator published different text while this one was parked). Either way
 * replaying would overwrite newer work, so the row is superseded and no
 * provider call is made.
 */
async function precheckRetry(
  sql: TransactionSql,
  attemptId: string
): Promise<RetryPrecheck | null> {
  const [attempt] = await sql<RetryPrecheck[]>`
    select
      pa.id::text as id,
      pa.operation,
      pa.intended_body as "intendedBody",
      pa.publish_generation as "attemptGeneration",
      rr.review_id::text as "reviewId",
      rr.id::text as "reviewReplyId",
      rr.publish_generation as "replyGeneration",
      r.google_review_name_ciphertext as "googleReviewNameCiphertext",
      r.restricted_at as "restrictedAt",
      e.google_connection_id::text as "connectionId",
      exists (
        select 1
        from publish_attempt newer
        where newer.review_reply_id = pa.review_reply_id
          and newer.status = 'succeeded'
          and newer.started_at > pa.started_at
      ) as "supersededBySuccess"
    from publish_attempt pa
    join review_reply rr on rr.id = pa.review_reply_id
    join review r on r.id = rr.review_id
    join external_location e on e.id = r.external_location_id
    where pa.id = ${attemptId}
      and pa.status = 'retryable'
      and pa.next_attempt_at <= now()
    limit 1
  `
  return attempt ?? null
}

/** Claim the due `retryable` row as a new `started` attempt. */
async function claimRetry(
  sql: TransactionSql,
  organisationId: string,
  attemptId: string
): Promise<RetryClaim> {
  const precheck = await precheckRetry(sql, attemptId)
  if (!precheck) return { kind: "settled", result: "skipped" }

  // A restriction fulfilled after the attempt was queued must stop the
  // republish: the retry path never goes through preparePublish, so this is
  // the only gate it passes. A delete is remediation, not processing, and
  // stays allowed.
  if (precheck.restrictedAt && precheck.operation === "publish") {
    const settled = await sql`
      update publish_attempt
      set
        status = 'failed',
        provider_error_code = 'review_restricted',
        next_attempt_at = null,
        finished_at = now()
      where id = ${attemptId}
        and status = 'retryable'
      returning id
    `
    if (settled.length === 0) return { kind: "settled", result: "skipped" }
    await writePublishAttemptEvent(sql, {
      organisationId,
      publishAttemptId: attemptId,
      eventType: "completed",
      payload: { result: "failed", code: "review_restricted", ...JOB_RUNNER },
    })
    await applyFailedReply(sql, {
      reviewReplyId: precheck.reviewReplyId,
      reviewId: precheck.reviewId,
    })
    return { kind: "settled", result: "failed" }
  }

  const staleGeneration =
    precheck.attemptGeneration !== null &&
    precheck.attemptGeneration !== precheck.replyGeneration
  if (staleGeneration || precheck.supersededBySuccess) {
    await supersedeAttempts(sql, {
      organisationId,
      attemptIds: [attemptId],
      reason: staleGeneration ? "stale_generation" : "newer_reply_published",
    })
    return { kind: "settled", result: "skipped" }
  }

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
  if (!claimed) return { kind: "settled", result: "skipped" }
  await writePublishAttemptEvent(sql, {
    organisationId,
    publishAttemptId: attemptId,
    eventType: "started",
    payload: { attemptNo: claimed.attemptNo, ...JOB_RUNNER },
  })
  return {
    kind: "claimed",
    context: {
      id: precheck.id,
      operation: precheck.operation,
      intendedBody: precheck.intendedBody,
      attemptNo: claimed.attemptNo,
      reviewId: precheck.reviewId,
      reviewReplyId: precheck.reviewReplyId,
      googleReviewNameCiphertext: precheck.googleReviewNameCiphertext,
      connectionId: precheck.connectionId,
    },
  }
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
  const claim = await withTenant(organisationId, (sql) =>
    claimRetry(sql, organisationId, attemptId)
  )
  if (claim.kind === "settled") return claim.result
  const { context } = claim

  const call = await replayAtGoogle(organisationId, context)

  return withTenant<RetryResult>(organisationId, async (sql) => {
    if (call.response !== undefined) {
      await settleRetrySuccess(sql, organisationId, context, call.response)
      return "succeeded"
    }
    return settleRetryFailure(sql, organisationId, context, call.error)
  })
}
