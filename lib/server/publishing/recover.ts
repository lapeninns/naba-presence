import "server-only"

/**
 * Recovery of an in-flight or ambiguous attempt. The provider state is read
 * FIRST and the intended body compared; the attempt then settles as
 * `succeeded` (the write applied), `not_applied` (safe to retry now), or
 * `diverged` (Google holds a different reply; the attempt fails
 * permanently and the divergence is audited). Ambiguous writes are never
 * blindly repeated.
 */

import type { TransactionSql } from "postgres"

import { deleteWorkflowTarget } from "@/lib/domain/workflow"
import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { GoogleMutationAmbiguousError } from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"

import { markAttemptSucceeded, writePublishAttemptEvent } from "./attempt"
import {
  googleReplyFromReview,
  googleReplyMatches,
  readGoogleReview,
  replyTarget,
  type GoogleReviewResource,
} from "./provider"
import { applyDeletedReply, setReviewWorkflow } from "./settle"
import type { PublishAttemptOperation, RecoveryResult } from "./types"

type AttemptRecoveryContext = {
  id: string
  status: string
  operation: PublishAttemptOperation
  intended_body: string | null
  started_at: Date
  review_id: string
  review_reply_id: string
  google_review_name_ciphertext: Buffer
  google_connection_id: string
}

const IN_FLIGHT_GRACE_MS = 2 * 60 * 1000

async function loadRecoveryContext(input: {
  organisationId: string
  attemptId: string
}): Promise<AttemptRecoveryContext | null> {
  return withTenant(input.organisationId, async (sql) => {
    const [attempt] = await sql<AttemptRecoveryContext[]>`
      select
        pa.id::text as id,
        pa.status,
        pa.operation,
        pa.intended_body,
        pa.started_at,
        rr.review_id::text as review_id,
        rr.id::text as review_reply_id,
        r.google_review_name_ciphertext,
        el.google_connection_id::text as google_connection_id
      from publish_attempt pa
      join review_reply rr on rr.id = pa.review_reply_id
      join review r on r.id = rr.review_id
      join external_location el on el.id = r.external_location_id
      where pa.id = ${input.attemptId}
      limit 1
    `
    return attempt ?? null
  })
}

/** Compare the live provider reply with the intended mutation. */
export function decideRecovery(
  context: Pick<AttemptRecoveryContext, "operation" | "intended_body">,
  review: GoogleReviewResource
): RecoveryResult {
  const providerReply = googleReplyFromReview(review)
  if (context.operation === "delete") {
    return providerReply === null ? "succeeded" : "not_applied"
  }
  if (
    context.intended_body !== null &&
    googleReplyMatches(review, context.intended_body)
  ) {
    return "succeeded"
  }
  return providerReply === null ? "not_applied" : "diverged"
}

async function settleRecoveredSuccess(
  sql: TransactionSql,
  organisationId: string,
  context: AttemptRecoveryContext
) {
  await markAttemptSucceeded(sql, context.id)
  if (context.operation === "delete") {
    await applyDeletedReply(sql, context.review_reply_id)
  } else {
    await sql`
      update review_reply
      set
        publish_status = 'published',
        first_published_at = coalesce(first_published_at, now())
      where id = ${context.review_reply_id}
    `
  }
  await setReviewWorkflow(
    sql,
    context.review_id,
    context.operation === "delete"
      ? deleteWorkflowTarget("remote")
      : "published"
  )
  await writePublishAttemptEvent(sql, {
    organisationId,
    publishAttemptId: context.id,
    eventType: "completed",
    payload: { result: "succeeded" },
  })
}

async function settleRecoveredNotApplied(
  sql: TransactionSql,
  organisationId: string,
  context: AttemptRecoveryContext
) {
  await sql`
    update publish_attempt
    set
      status = 'retryable',
      next_attempt_at = now(),
      finished_at = now()
    where id = ${context.id}
  `
  await writePublishAttemptEvent(sql, {
    organisationId,
    publishAttemptId: context.id,
    eventType: "retry_scheduled",
    payload: { result: "not_applied" },
  })
}

async function settleRecoveredDiverged(
  sql: TransactionSql,
  organisationId: string,
  context: AttemptRecoveryContext
) {
  await sql`
    update publish_attempt
    set
      status = 'failed',
      provider_error_code = 'reply_diverged',
      next_attempt_at = null,
      finished_at = now()
    where id = ${context.id}
  `
  await writePublishAttemptEvent(sql, {
    organisationId,
    publishAttemptId: context.id,
    eventType: "completed",
    payload: { result: "diverged" },
  })
  await writeAudit(sql, {
    organisationId,
    action: "review.reply.diverged",
    subjectType: "review",
    subjectId: context.review_id,
    metadata: {
      publishAttemptId: context.id,
      operation: context.operation,
    },
  })
}

async function settleRecovery(
  sql: TransactionSql,
  organisationId: string,
  context: AttemptRecoveryContext,
  result: RecoveryResult,
  providerReplyPresent: boolean
) {
  await writePublishAttemptEvent(sql, {
    organisationId,
    publishAttemptId: context.id,
    eventType: "ambiguity_checked",
    payload: {
      result,
      operation: context.operation,
      providerReplyPresent,
    },
  })
  if (result === "succeeded") {
    await settleRecoveredSuccess(sql, organisationId, context)
  } else if (result === "not_applied") {
    await settleRecoveredNotApplied(sql, organisationId, context)
  } else {
    await settleRecoveredDiverged(sql, organisationId, context)
  }
}

export async function recoverAttempt(input: {
  organisationId: string
  attemptId: string
}): Promise<RecoveryResult> {
  const context = await loadRecoveryContext(input)
  if (!context || !["started", "ambiguous"].includes(context.status)) {
    return "not_applied"
  }
  if (
    context.status === "started" &&
    Date.now() - context.started_at.getTime() < IN_FLIGHT_GRACE_MS
  ) {
    throw new ApiError(409, "publish_in_progress", "A publish is in flight.")
  }

  const review = await readGoogleReview(
    replyTarget({
      organisationId: input.organisationId,
      connectionId: context.google_connection_id,
      googleReviewNameCiphertext: context.google_review_name_ciphertext,
    })
  )
  const result = decideRecovery(context, review)
  const providerReplyPresent = googleReplyFromReview(review) !== null

  await withTenant(input.organisationId, (sql) =>
    settleRecovery(
      sql,
      input.organisationId,
      context,
      result,
      providerReplyPresent
    )
  )
  return result
}

export type RequestRecovery =
  | { kind: "ambiguous" }
  | { kind: "recovered"; result: Exclude<RecoveryResult, "diverged"> }

/**
 * Recovery as seen from an interactive request that found an in-flight or
 * ambiguous attempt in its way: an unreadable provider state is reported as
 * `ambiguous`, a divergence is a 409, and anything else lets the caller
 * re-run its own pipeline against the settled row.
 */
export async function recoverForRequest(input: {
  organisationId: string
  attemptId: string
}): Promise<RequestRecovery> {
  let result: RecoveryResult
  try {
    result = await recoverAttempt(input)
  } catch (error) {
    if (error instanceof GoogleMutationAmbiguousError) {
      return { kind: "ambiguous" }
    }
    throw error
  }
  if (result === "diverged") {
    throw new ApiError(
      409,
      "reply_diverged",
      "The live Google reply differs from the intended reply."
    )
  }
  return { kind: "recovered", result }
}
