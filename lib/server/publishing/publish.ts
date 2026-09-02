import "server-only"

/**
 * `executePublish`: the three-phase reply publish.
 *   1. intent   (./intent.ts)   one tenant txn: gates, approval routing,
 *                               idempotency, durable `started` attempt
 *   2. provider (./provider.ts) Google reply PUT outside any transaction
 *   3. settle   (here)          one tenant txn: local reply + attempt row +
 *                               attempt events + workflow + audit
 * An in-flight or ambiguous attempt for the same key is recovered first
 * (./recover.ts) and the publish re-run against the settled row.
 */

import type { TransactionSql } from "postgres"

import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"

import {
  classifyProviderFailure,
  markAttemptSucceeded,
  recordAttemptFailure,
  writePublishAttemptEvent,
} from "./attempt"
import { preparePublish, type PublishIntent } from "./intent"
import { publishReplyToGoogle, type GoogleReviewReply } from "./provider"
import { recoverForRequest } from "./recover"
import {
  applyFailedReply,
  applyPublishedReply,
  setReviewWorkflow,
} from "./settle"
import type { PublishInput, PublishOutcome } from "./types"

async function settlePublishSuccess(
  sql: TransactionSql,
  input: PublishInput,
  intent: PublishIntent,
  provider: GoogleReviewReply
): Promise<PublishOutcome> {
  const { googleState, publishStatus } = await applyPublishedReply(
    sql,
    intent.reviewReplyId,
    provider
  )
  const rejected = googleState === "REJECTED"
  await markAttemptSucceeded(sql, intent.attemptId)
  await writePublishAttemptEvent(sql, {
    organisationId: input.organisationId,
    publishAttemptId: intent.attemptId,
    eventType: rejected ? "provider_rejected" : "provider_accepted",
    payload: { googleReplyState: googleState },
  })
  await writePublishAttemptEvent(sql, {
    organisationId: input.organisationId,
    publishAttemptId: intent.attemptId,
    eventType: "completed",
    payload: { publishStatus },
  })
  await setReviewWorkflow(
    sql,
    input.reviewId,
    rejected ? "rejected" : "published"
  )
  await writeAudit(sql, {
    organisationId: input.organisationId,
    actorUserId: input.session.userId,
    action: rejected ? "review.reply.rejected" : "review.reply.published",
    subjectType: "review",
    subjectId: input.reviewId,
    requestId: input.requestId,
    metadata: {
      draftId: intent.draftId,
      publishAttemptId: intent.attemptId,
      googleReplyState: googleState,
      verificationStatus: intent.verificationStatus,
    },
  })
  return {
    status: publishStatus,
    googleReplyState: googleState,
    attemptId: intent.attemptId,
    reviewReplyId: intent.reviewReplyId,
  }
}

async function settlePublishFailure(
  sql: TransactionSql,
  input: PublishInput,
  intent: PublishIntent,
  error: unknown
): Promise<PublishOutcome> {
  const failure = classifyProviderFailure(error, intent.attemptNo)
  await recordAttemptFailure(sql, {
    organisationId: input.organisationId,
    attemptId: intent.attemptId,
    failure,
  })
  if (failure.terminal) {
    await applyFailedReply(sql, {
      reviewReplyId: intent.reviewReplyId,
      reviewId: input.reviewId,
    })
  }
  await writeAudit(sql, {
    organisationId: input.organisationId,
    actorUserId: input.session.userId,
    action: "review.reply.publish_failed",
    subjectType: "review",
    subjectId: input.reviewId,
    requestId: input.requestId,
    metadata: {
      publishAttemptId: intent.attemptId,
      failureStatus: failure.status,
      nextAttemptAt: failure.nextAttemptAt?.toISOString() ?? null,
    },
  })
  return {
    status: failure.ambiguous ? "ambiguous" : "failed",
    googleReplyState: null,
    attemptId: intent.attemptId,
    reviewReplyId: intent.reviewReplyId,
    providerError: {
      status: error instanceof ApiError ? error.status : 502,
      code: failure.errorCode,
      message:
        error instanceof Error ? error.message : "Google publish failed.",
    },
  }
}

export async function executePublish(
  input: PublishInput
): Promise<PublishOutcome> {
  const phaseOne = await preparePublish(input)
  if (phaseOne.kind === "outcome") return phaseOne.outcome
  if (phaseOne.kind === "needs_recovery") {
    const recovery = await recoverForRequest({
      organisationId: input.organisationId,
      attemptId: phaseOne.attemptId,
    })
    if (recovery.kind === "ambiguous") {
      return {
        status: "ambiguous",
        googleReplyState: null,
        attemptId: phaseOne.attemptId,
      }
    }
    return executePublish(input)
  }

  const call = await publishReplyToGoogle(phaseOne.target, phaseOne.body)

  return withTenant(input.organisationId, (sql) =>
    call.response !== undefined
      ? settlePublishSuccess(sql, input, phaseOne, call.response)
      : settlePublishFailure(sql, input, phaseOne, call.error)
  )
}
