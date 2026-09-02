import "server-only"

/**
 * `executeReplyDelete`: the three-phase reply delete. A reply that never
 * reached Google (awaiting approval, or accepted with no provider write) is
 * cancelled locally without a mutation intent; anything else goes through
 * intent -> provider DELETE -> settle, with the same recovery-first rule
 * for in-flight or ambiguous attempts as a publish.
 */

import type { TransactionSql } from "postgres"

import { deleteWorkflowTarget } from "@/lib/domain/workflow"
import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import {
  canPublishLocation,
  requireLocationAccess,
} from "@/lib/server/permissions"

import {
  classifyProviderFailure,
  findAttemptByKey,
  insertAttempt,
  markAttemptSucceeded,
  rearmAttempt,
  recordAttemptFailure,
  writePublishAttemptEvent,
  type ExistingAttempt,
} from "./attempt"
import {
  deleteReplyFromGoogle,
  replyTarget,
  type ReplyTarget,
} from "./provider"
import { recoverForRequest } from "./recover"
import { applyDeletedReply, setReviewWorkflow } from "./settle"
import type {
  PublishAttemptOperation,
  ReplyDeleteInput,
  ReplyDeleteOutcome,
} from "./types"

/** The review + reply join a delete is decided on. */
export type DeleteRecord = {
  review_id: string
  workflow_status: string
  google_review_name_ciphertext: Buffer
  location_id: string
  connection_id: string
  review_reply_id: string
  publish_status: string
  publish_generation: number
  google_reply_updated_at: Date | null
  has_succeeded_publish: boolean
}

export type DeleteIntent = {
  attemptId: string
  attemptNo: number
  reviewReplyId: string
  target: ReplyTarget
}

export type DeletePhaseOne =
  | {
      kind: "outcome"
      outcome: { status: "deleted" | "cancelled"; attemptId: string | null }
    }
  | {
      kind: "needs_recovery"
      attemptId: string
      operation: PublishAttemptOperation
    }
  | ({ kind: "proceed" } & DeleteIntent)

async function loadDeleteRecord(
  sql: TransactionSql,
  reviewId: string
): Promise<DeleteRecord> {
  const [record] = await sql<DeleteRecord[]>`
    select
      r.id::text as review_id,
      r.workflow_status,
      r.google_review_name_ciphertext,
      r.location_id::text as location_id,
      el.google_connection_id::text as connection_id,
      rr.id::text as review_reply_id,
      rr.publish_status,
      rr.publish_generation,
      rr.google_reply_updated_at,
      exists (
        select 1
        from publish_attempt succeeded
        where succeeded.review_reply_id = rr.id
          and succeeded.operation = 'publish'
          and succeeded.status = 'succeeded'
      ) as has_succeeded_publish
    from review r
    join external_location el on el.id = r.external_location_id
    join review_reply rr on rr.review_id = r.id
    where r.id = ${reviewId}
    limit 1
  `
  if (!record) {
    throw new ApiError(404, "reply_not_found", "Published reply not found.")
  }
  return record
}

async function findActiveAttempt(sql: TransactionSql, reviewReplyId: string) {
  const [activeAttempt] = await sql<
    { id: string; operation: PublishAttemptOperation }[]
  >`
    select id::text as id, operation
    from publish_attempt
    where review_reply_id = ${reviewReplyId}
      and status in ('started', 'ambiguous')
    order by started_at desc
    limit 1
  `
  return activeAttempt ?? null
}

/** A reply that never reached Google is withdrawn locally, without a provider call. */
function isLocalCancel(record: DeleteRecord) {
  return (
    record.publish_status === "awaiting_approval" ||
    (record.publish_status === "accepted" &&
      !record.has_succeeded_publish &&
      record.google_reply_updated_at === null)
  )
}

async function cancelLocally(
  sql: TransactionSql,
  input: ReplyDeleteInput,
  record: DeleteRecord
): Promise<DeletePhaseOne> {
  await sql`
    update review_reply
    set
      publish_status = 'not_published',
      google_reply_state = null,
      google_policy_violation = null,
      published_by = null
    where id = ${record.review_reply_id}
  `
  await setReviewWorkflow(
    sql,
    record.review_id,
    deleteWorkflowTarget("local_cancel")
  )
  await writeAudit(sql, {
    organisationId: input.organisationId,
    actorUserId: input.session.userId,
    action: "review.reply.cancelled",
    subjectType: "review",
    subjectId: record.review_id,
    requestId: input.requestId,
  })
  return { kind: "outcome", outcome: { status: "cancelled", attemptId: null } }
}

/** Delete idempotency is derived from organisation, review and the reply generation. */
export function deleteIdempotencyKey(input: {
  organisationId: string
  reviewId: string
  publishGeneration: number
}) {
  return sha256(
    `${input.organisationId}:${input.reviewId}:delete:${input.publishGeneration}`
  )
}

function resolveExistingDeleteAttempt(
  existing: ExistingAttempt | null
): DeletePhaseOne | null {
  if (!existing) return null
  if (existing.status === "succeeded") {
    return {
      kind: "outcome",
      outcome: { status: "deleted", attemptId: existing.id },
    }
  }
  if (existing.status === "failed") {
    throw new ApiError(
      409,
      "previous_delete_failed",
      "The previous provider rejection is permanent."
    )
  }
  if (
    existing.next_attempt_at &&
    existing.next_attempt_at.getTime() > Date.now()
  ) {
    throw new ApiError(
      429,
      "delete_retry_not_ready",
      `Retry after ${existing.next_attempt_at.toISOString()}.`
    )
  }
  return null
}

async function startDeleteIntent(
  sql: TransactionSql,
  input: ReplyDeleteInput,
  record: DeleteRecord,
  key: { idempotencyKey: string; existing: ExistingAttempt | null }
): Promise<DeleteIntent> {
  const attempt = key.existing
    ? await rearmAttempt(sql, { attemptId: key.existing.id })
    : await insertAttempt(sql, {
        organisationId: input.organisationId,
        reviewReplyId: record.review_reply_id,
        draftId: null,
        idempotencyKey: key.idempotencyKey,
        requestBodyHash: sha256(""),
        operation: "delete",
        intendedBody: null,
      })
  await writePublishAttemptEvent(sql, {
    organisationId: input.organisationId,
    publishAttemptId: attempt.id,
    eventType: "started",
    payload: { attemptNo: attempt.attempt_no, operation: "delete" },
  })
  await writeAudit(sql, {
    organisationId: input.organisationId,
    actorUserId: input.session.userId,
    action: "review.reply.delete_requested",
    subjectType: "review",
    subjectId: record.review_id,
    requestId: input.requestId,
    metadata: { publishAttemptId: attempt.id },
  })
  return {
    attemptId: attempt.id,
    attemptNo: attempt.attempt_no,
    reviewReplyId: record.review_reply_id,
    target: replyTarget({
      organisationId: input.organisationId,
      connectionId: record.connection_id,
      googleReviewNameCiphertext: record.google_review_name_ciphertext,
    }),
  }
}

/** The whole phase-one transaction. */
async function prepareDelete(input: ReplyDeleteInput): Promise<DeletePhaseOne> {
  return withTenant<DeletePhaseOne>(input.organisationId, async (sql) => {
    const record = await loadDeleteRecord(sql, input.reviewId)
    await requireLocationAccess(sql, input.session, record.location_id)
    if (!(await canPublishLocation(sql, input.session, record.location_id))) {
      throw new ApiError(
        403,
        "publish_permission_required",
        "You do not have publish permission for this location."
      )
    }

    const activeAttempt = await findActiveAttempt(sql, record.review_reply_id)
    if (activeAttempt) {
      return {
        kind: "needs_recovery",
        attemptId: activeAttempt.id,
        operation: activeAttempt.operation,
      }
    }
    if (["deleted", "not_published"].includes(record.publish_status)) {
      throw new ApiError(404, "reply_not_found", "Published reply not found.")
    }
    if (isLocalCancel(record)) return cancelLocally(sql, input, record)

    const idempotencyKey = deleteIdempotencyKey({
      organisationId: input.organisationId,
      reviewId: record.review_id,
      publishGeneration: record.publish_generation,
    })
    const existing = await findAttemptByKey(sql, {
      organisationId: input.organisationId,
      idempotencyKey,
    })
    const resolved = resolveExistingDeleteAttempt(existing)
    if (resolved) return resolved

    const intent = await startDeleteIntent(sql, input, record, {
      idempotencyKey,
      existing,
    })
    return { kind: "proceed", ...intent }
  })
}

async function settleDeleteSuccess(
  sql: TransactionSql,
  input: ReplyDeleteInput,
  intent: DeleteIntent
) {
  await applyDeletedReply(sql, intent.reviewReplyId)
  await setReviewWorkflow(sql, input.reviewId, deleteWorkflowTarget("remote"))
  await markAttemptSucceeded(sql, intent.attemptId)
  await writePublishAttemptEvent(sql, {
    organisationId: input.organisationId,
    publishAttemptId: intent.attemptId,
    eventType: "provider_accepted",
    payload: { operation: "delete" },
  })
  await writePublishAttemptEvent(sql, {
    organisationId: input.organisationId,
    publishAttemptId: intent.attemptId,
    eventType: "completed",
    payload: { status: "deleted" },
  })
  await writeAudit(sql, {
    organisationId: input.organisationId,
    actorUserId: input.session.userId,
    action: "review.reply.deleted",
    subjectType: "review",
    subjectId: input.reviewId,
    requestId: input.requestId,
    metadata: { publishAttemptId: intent.attemptId },
  })
}

async function settleDeleteFailure(
  sql: TransactionSql,
  input: ReplyDeleteInput,
  intent: DeleteIntent,
  error: unknown
) {
  const failure = classifyProviderFailure(error, intent.attemptNo)
  await recordAttemptFailure(sql, {
    organisationId: input.organisationId,
    attemptId: intent.attemptId,
    failure,
    eventPayload: { operation: "delete" },
  })
  await writeAudit(sql, {
    organisationId: input.organisationId,
    actorUserId: input.session.userId,
    action: "review.reply.delete_failed",
    subjectType: "review",
    subjectId: input.reviewId,
    requestId: input.requestId,
    metadata: {
      publishAttemptId: intent.attemptId,
      status: failure.status,
    },
  })
  return failure
}

export async function executeReplyDelete(
  input: ReplyDeleteInput
): Promise<ReplyDeleteOutcome> {
  const phaseOne = await prepareDelete(input)
  if (phaseOne.kind === "outcome") return phaseOne.outcome
  if (phaseOne.kind === "needs_recovery") {
    const recovery = await recoverForRequest({
      organisationId: input.organisationId,
      attemptId: phaseOne.attemptId,
    })
    if (recovery.kind === "ambiguous") {
      return { status: "ambiguous", attemptId: phaseOne.attemptId }
    }
    if (phaseOne.operation === "delete" && recovery.result === "succeeded") {
      return { status: "deleted", attemptId: phaseOne.attemptId }
    }
    return executeReplyDelete(input)
  }

  const call = await deleteReplyFromGoogle(phaseOne.target, {
    treatNotFoundAsApplied: true,
  })

  const failure = await withTenant(input.organisationId, async (sql) => {
    if (call.response !== undefined) {
      await settleDeleteSuccess(sql, input, phaseOne)
      return null
    }
    return settleDeleteFailure(sql, input, phaseOne, call.error)
  })

  if (!failure) return { status: "deleted", attemptId: phaseOne.attemptId }
  if (failure.ambiguous) {
    return { status: "ambiguous", attemptId: phaseOne.attemptId }
  }
  if (failure.error instanceof ApiError) throw failure.error
  throw new ApiError(502, "google_delete_failed", "Google delete failed.")
}
