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
import { recheckAuthorisation } from "@/lib/server/authz/actor"
import { withTenant } from "@/lib/server/db"
import { isScopeEnabled } from "@/lib/server/pause-controls"

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
  lockReview,
  lockReviewForAttempt,
  setReviewWorkflow,
} from "./settle"
import { storedReplyContentChecks } from "@/lib/server/content-checks"
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
  draftId: string | null
  reviewText: string | null
  attemptGeneration: number | null
  replyGeneration: number
  restrictedAt: Date | null
  supersededBySuccess: boolean
  locationId: string
  authorisedBy: string | null
  authorisedSecurityVersion: number | null
  authorisedConnectionId: string | null
  authorisedApprovalRequired: boolean | null
  authorisedTwoPersonApproval: boolean | null
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
      pa.draft_id::text as "draftId",
      r.review_text as "reviewText",
      pa.intended_body as "intendedBody",
      pa.publish_generation as "attemptGeneration",
      rr.review_id::text as "reviewId",
      rr.id::text as "reviewReplyId",
      rr.publish_generation as "replyGeneration",
      r.google_review_name_ciphertext as "googleReviewNameCiphertext",
      r.restricted_at as "restrictedAt",
      e.google_connection_id::text as "connectionId",
      r.location_id::text as "locationId",
      pa.authorised_by::text as "authorisedBy",
      pa.authorised_security_version as "authorisedSecurityVersion",
      pa.authorised_connection_id::text as "authorisedConnectionId",
      pa.authorised_approval_required as "authorisedApprovalRequired",
      pa.authorised_two_person_approval as "authorisedTwoPersonApproval",
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

/**
 * Re-decides the authorisation recorded on the attempt (0106) before a
 * replay. Null when it still holds; otherwise the code the attempt settles
 * with. A row with nobody recorded (its person deleted, or a pre-0106 row
 * the backfill could not attribute) cannot be rechecked and is refused
 * rather than replayed, as is a publish with no policy recorded.
 *
 * A publish must also still be under the approval policy it was queued
 * under: the replay never passes the approval gate again, so a reply queued
 * before an owner turned approval (or two-person approval) on would
 * otherwise reach Google unapproved. A delete is remediation and is never
 * held for approval, so its policy is not compared.
 */
async function recheckRetryAuthorisation(
  sql: TransactionSql,
  organisationId: string,
  precheck: RetryPrecheck
): Promise<{ code: string; reason: string } | null> {
  if (!precheck.authorisedBy) {
    return {
      code: "authorisation_unverifiable",
      reason: "authorised_by_missing",
    }
  }
  const isPublish = precheck.operation === "publish"
  if (
    isPublish &&
    (precheck.authorisedApprovalRequired === null ||
      precheck.authorisedTwoPersonApproval === null)
  ) {
    return { code: "authorisation_unverifiable", reason: "policy_missing" }
  }
  const recheck = await recheckAuthorisation(sql, {
    organisationId,
    actorUserId: precheck.authorisedBy,
    locationId: precheck.locationId,
    action: "publish",
    connectionId: precheck.authorisedConnectionId,
    securityVersion: precheck.authorisedSecurityVersion,
    policy: isPublish
      ? {
          approvalRequired: precheck.authorisedApprovalRequired as boolean,
          requireTwoPersonApproval:
            precheck.authorisedTwoPersonApproval as boolean,
        }
      : null,
  })
  if (recheck.ok) {
    // The replay itself goes through the review's connection; it must be the
    // one the person authorised. Rows without one recorded fail closed.
    if (
      !precheck.authorisedConnectionId ||
      precheck.authorisedConnectionId.toLowerCase() !==
        precheck.connectionId.toLowerCase()
    ) {
      return { code: "authorisation_revoked", reason: "connection_changed" }
    }
    return null
  }
  return { code: "authorisation_revoked", reason: recheck.reason }
}

/**
 * Settles a due `retryable` row `failed` without calling Google, and the
 * reply with it: a restriction fulfilled after it was queued, or an
 * authorisation that no longer holds.
 */
async function failBeforeDispatch(
  sql: TransactionSql,
  organisationId: string,
  precheck: RetryPrecheck,
  code: string,
  detail: Record<string, unknown> = {}
): Promise<RetryClaim> {
  const settled = await sql`
    update publish_attempt
    set
      status = 'failed',
      provider_error_code = ${code},
      next_attempt_at = null,
      finished_at = now()
    where id = ${precheck.id}
      and status = 'retryable'
    returning id
  `
  if (settled.length === 0) return { kind: "settled", result: "skipped" }
  await writePublishAttemptEvent(sql, {
    organisationId,
    publishAttemptId: precheck.id,
    eventType: "completed",
    payload: { result: "failed", code, ...detail, ...JOB_RUNNER },
  })
  await applyFailedReply(sql, {
    reviewReplyId: precheck.reviewReplyId,
    reviewId: precheck.reviewId,
  })
  return { kind: "settled", result: "failed" }
}

/** Claim the due `retryable` row as a new `started` attempt. */
async function claimRetry(
  sql: TransactionSql,
  organisationId: string,
  attemptId: string
): Promise<RetryClaim> {
  await lockReviewForAttempt(sql, attemptId)
  const precheck = await precheckRetry(sql, attemptId)
  if (!precheck) return { kind: "settled", result: "skipped" }

  // A restriction fulfilled after the attempt was queued must stop the
  // republish: the retry path never goes through preparePublish, so this is
  // the only gate it passes. A delete is remediation, not processing, and
  // stays allowed.
  if (precheck.restrictedAt && precheck.operation === "publish") {
    return failBeforeDispatch(
      sql,
      organisationId,
      precheck,
      "review_restricted"
    )
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

  // The person who asked for this mutation must still be allowed to make it,
  // through the same Google connection, under the same security version and
  // approval policy (P02-S9): the replay is made on their behalf, possibly
  // hours later.
  const refusal = await recheckRetryAuthorisation(sql, organisationId, precheck)
  if (refusal) {
    return failBeforeDispatch(sql, organisationId, precheck, refusal.code, {
      reason: refusal.reason,
    })
  }

  if (precheck.operation === "publish") {
    if (!precheck.draftId || precheck.intendedBody === null) {
      return failBeforeDispatch(
        sql,
        organisationId,
        precheck,
        "verification_required"
      )
    }
    const reasons = await storedReplyContentChecks(sql, {
      draftId: precheck.draftId,
      body: precheck.intendedBody,
      reviewText: precheck.reviewText,
    })
    const [verification] = reasons.some((reason) => reason.severity === "warn")
      ? await sql<{ reasons: { code: string }[] }[]>`
          select reasons from verification_result where draft_id = ${precheck.draftId}
          order by created_at desc, id desc limit 1
        `
      : []
    if (
      reasons.some(
        (reason) =>
          reason.severity === "fail" ||
          !verification?.reasons.some(
            (previous) => previous.code === reason.code
          )
      )
    ) {
      return failBeforeDispatch(
        sql,
        organisationId,
        precheck,
        "verification_required",
        { reasons }
      )
    }
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
  // The dispatch half of the pause: the runner stops claiming `retry` when
  // `publish` is paused, but an item it claimed just before the pause lands
  // here. Skipped leaves the row `retryable` with its back-off untouched, so
  // no retry budget is spent while paused; an unreadable pause table skips
  // too.
  if (!(await isScopeEnabled("publish"))) return "skipped"
  const claim = await withTenant(organisationId, (sql) =>
    claimRetry(sql, organisationId, attemptId)
  )
  if (claim.kind === "settled") return claim.result
  const { context } = claim

  const call = await replayAtGoogle(organisationId, context)

  return withTenant<RetryResult>(organisationId, async (sql) => {
    await lockReview(sql, context.reviewId)
    if (call.response !== undefined) {
      await settleRetrySuccess(sql, organisationId, context, call.response)
      return "succeeded"
    }
    return settleRetryFailure(sql, organisationId, context, call.error)
  })
}
