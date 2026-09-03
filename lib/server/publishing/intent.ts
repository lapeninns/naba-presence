import "server-only"

/**
 * Phase one of a publish: load the review + draft, run the publish gates,
 * route to approval when required, resolve the idempotency key against any
 * existing attempt, and persist the `started` mutation intent. Everything
 * here runs in ONE tenant transaction so the intent exists durably before
 * the provider call.
 */

import type { TransactionSql } from "postgres"

import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { withTenant } from "@/lib/server/db"
import { buildEvidenceHash } from "@/lib/server/drafts"
import { ApiError } from "@/lib/server/http"
import {
  canPublishLocation,
  requireLocationAccess,
} from "@/lib/server/permissions"

import { requestApproval, requiresApproval } from "./approval"
import {
  findAttemptByKey,
  insertAttempt,
  rearmAttempt,
  supersedeQueuedSiblings,
  writePublishAttemptEvent,
  type ExistingAttempt,
} from "./attempt"
import { replyTarget, type ReplyTarget } from "./provider"
import { setReviewWorkflow } from "./settle"
import type { PublishInput, PublishOutcome } from "./types"

/** The review + draft + organisation + reply join a publish is decided on. */
export type PublishRecord = {
  review_id: string
  google_review_name_ciphertext: Buffer
  update_time: Date
  restricted_at: Date | null
  review_text: string | null
  rating: number | null
  location_name: string
  location_id: string
  verified: boolean
  connection_id: string
  body: string
  evidence_hash: string
  tone: string
  language: string
  business_context: string | null
  draft_policy_version: string
  verification_status: string
  approval_required: boolean
  require_two_person_approval: boolean
  has_qualifying_approval: boolean
  publish_generation: number
}

export type PublishIntent = {
  attemptId: string
  attemptNo: number
  reviewReplyId: string
  target: ReplyTarget
  body: string
  draftId: string
  verificationStatus: string
}

export type PublishPhaseOne =
  | { kind: "outcome"; outcome: PublishOutcome }
  | { kind: "needs_recovery"; attemptId: string }
  | ({ kind: "proceed" } & PublishIntent)

export async function loadPublishRecord(
  sql: TransactionSql,
  input: { reviewId: string; draftId: string }
): Promise<PublishRecord> {
  const [record] = await sql<PublishRecord[]>`
    select
      r.id::text as review_id,
      r.google_review_name_ciphertext,
      r.update_time,
      r.restricted_at,
      r.review_text,
      r.star_rating::integer as rating,
      l.name as location_name,
      r.location_id::text as location_id,
      e.verified,
      e.google_connection_id::text as connection_id,
      d.body,
      d.evidence_hash,
      d.tone,
      d.language,
      d.business_context,
      d.draft_policy_version,
      d.verification_status,
      o.approval_required,
      o.require_two_person_approval,
      exists (
        select 1
        from approval_decision ad
        where ad.review_id = r.id
          and ad.draft_id = d.id
          and ad.decision = 'approved'
          and ad.decided_by is distinct from rr.approval_requested_by
      ) as has_qualifying_approval,
      coalesce(rr.publish_generation, 0) as publish_generation
    from review r
    join location l on l.id = r.location_id
    join external_location e on e.id = r.external_location_id
    join draft d on d.review_id = r.id
    join organisation o on o.id = r.organisation_id
    left join review_reply rr
      on rr.organisation_id = r.organisation_id
     and rr.review_id = r.id
    where r.id = ${input.reviewId}
      and d.id = ${input.draftId}
    limit 1
  `
  if (!record) {
    throw new ApiError(
      404,
      "review_or_draft_not_found",
      "Review or draft not found."
    )
  }
  return record
}

/**
 * Publish gates: an unrestricted review, a verified location, a verified and
 * current draft, and evidence that still hashes to what verification saw.
 *
 * Restriction is checked here rather than only on the drafts route because a
 * draft verified BEFORE the restriction request was fulfilled still passes
 * every other gate - nothing a restriction touches feeds the evidence hash -
 * so publishing it would post a public reply to a data subject whose
 * restriction the audit trail already records as completed.
 */
export function assertDraftPublishable(
  record: PublishRecord,
  expectedReviewUpdateTime: string
) {
  if (record.restricted_at) {
    throw new ApiError(
      409,
      "review_restricted",
      "This review is restricted from reply processing."
    )
  }
  if (!record.verified) {
    throw new ApiError(
      409,
      "location_not_verified",
      "Replies can only be published for verified locations."
    )
  }
  if (record.verification_status === "fail") {
    throw new ApiError(
      409,
      "verification_failed",
      "This draft failed verification and cannot be published."
    )
  }
  if (record.verification_status === "pending") {
    throw new ApiError(
      409,
      "verification_required",
      "Verify this draft before publishing."
    )
  }
  if (record.update_time.toISOString() !== expectedReviewUpdateTime) {
    throw new ApiError(
      409,
      "review_changed",
      "The review changed after this draft was prepared."
    )
  }
  const currentEvidenceHash = buildEvidenceHash({
    reviewId: record.review_id,
    updateTime: record.update_time.toISOString(),
    reviewText: record.review_text,
    rating: record.rating,
    location: record.location_name,
    language: record.language,
    tone: record.tone,
    businessContext: record.business_context,
    draftPolicyVersion: record.draft_policy_version,
  })
  if (currentEvidenceHash !== record.evidence_hash) {
    throw new ApiError(
      409,
      "stale_draft_evidence",
      "The review changed since this draft was verified. Re-verify the draft."
    )
  }
}

/** Publish idempotency is derived from organisation, review, generation and body hash. */
export function publishIdempotencyKey(input: {
  organisationId: string
  reviewId: string
  publishGeneration: number
  bodyHash: string
}) {
  return sha256(
    `${input.organisationId}:${input.reviewId}:${input.publishGeneration}:${input.bodyHash}`
  )
}

/**
 * What an existing attempt for this key means: `succeeded` replays the
 * settled reply, `failed` is a permanent rejection, an in-flight or
 * `ambiguous` row must be recovered first, a `retryable` row waits for its
 * back-off. Returns null when a new/re-armed attempt may start.
 */
export async function resolveExistingPublishAttempt(
  sql: TransactionSql,
  existing: ExistingAttempt | null
): Promise<PublishPhaseOne | null> {
  if (!existing) return null
  if (existing.status === "succeeded") {
    const [reply] = await sql<
      {
        reviewReplyId: string
        status: "published" | "rejected" | "pending"
        googleReplyState: string | null
      }[]
    >`
      select
        id::text as "reviewReplyId",
        publish_status as status,
        google_reply_state as "googleReplyState"
      from review_reply
      where id = ${existing.review_reply_id}
    `
    return {
      kind: "outcome",
      outcome: {
        status: reply.status,
        googleReplyState: reply.googleReplyState,
        attemptId: existing.id,
        reviewReplyId: reply.reviewReplyId,
        idempotent: true,
      },
    }
  }
  if (existing.status === "failed") {
    throw new ApiError(
      409,
      "previous_publish_failed",
      "The previous provider rejection is permanent. Edit the reply before retrying."
    )
  }
  if (["started", "ambiguous"].includes(existing.status)) {
    return { kind: "needs_recovery", attemptId: existing.id }
  }
  if (
    existing.next_attempt_at &&
    existing.next_attempt_at.getTime() > Date.now()
  ) {
    throw new ApiError(
      429,
      "publish_retry_not_ready",
      `Retry after ${existing.next_attempt_at.toISOString()}.`
    )
  }
  return null
}

/**
 * Persist the `started` mutation intent: the accepted local reply, the
 * attempt row (new or re-armed), its `started` event, the
 * `publish_requested` workflow transition and the audit event.
 *
 * Returns null when a concurrent request won the idempotency key, so the
 * caller can resolve against the row that request wrote.
 */
export async function startPublishIntent(
  sql: TransactionSql,
  input: PublishInput,
  record: PublishRecord,
  key: {
    idempotencyKey: string
    bodyHash: string
    existing: ExistingAttempt | null
  }
): Promise<PublishIntent | null> {
  const [reply] = await sql<{ id: string }[]>`
    insert into review_reply (
      organisation_id,
      review_id,
      current_body,
      publish_status,
      published_by
    )
    values (
      ${input.organisationId},
      ${input.reviewId},
      ${record.body},
      'accepted',
      ${input.session.userId}
    )
    on conflict (organisation_id, review_id) do update
    set
      current_body = excluded.current_body,
      publish_status = 'accepted',
      published_by = excluded.published_by
    returning id::text as id
  `
  const attempt = key.existing
    ? await rearmAttempt(sql, {
        attemptId: key.existing.id,
        intendedBody: record.body,
      })
    : await insertAttempt(sql, {
        organisationId: input.organisationId,
        reviewReplyId: reply.id,
        draftId: input.draftId,
        idempotencyKey: key.idempotencyKey,
        requestBodyHash: key.bodyHash,
        operation: "publish",
        intendedBody: record.body,
        publishGeneration: record.publish_generation,
      })
  if (!attempt) return null
  await supersedeQueuedSiblings(sql, {
    organisationId: input.organisationId,
    reviewReplyId: reply.id,
    keepAttemptId: attempt.id,
    reason: "superseded_by_publish",
  })
  await writePublishAttemptEvent(sql, {
    organisationId: input.organisationId,
    publishAttemptId: attempt.id,
    eventType: "started",
    payload: { attemptNo: attempt.attempt_no },
  })
  await setReviewWorkflow(sql, input.reviewId, "publish_requested")
  await writeAudit(sql, {
    organisationId: input.organisationId,
    actorUserId: input.session.userId,
    action: "review.reply.publish_requested",
    subjectType: "review",
    subjectId: input.reviewId,
    requestId: input.requestId,
    metadata: {
      draftId: input.draftId,
      publishAttemptId: attempt.id,
      verificationStatus: record.verification_status,
    },
  })
  return {
    attemptId: attempt.id,
    attemptNo: attempt.attempt_no,
    reviewReplyId: reply.id,
    target: replyTarget({
      organisationId: input.organisationId,
      connectionId: record.connection_id,
      googleReviewNameCiphertext: record.google_review_name_ciphertext,
    }),
    body: record.body,
    draftId: input.draftId,
    verificationStatus: record.verification_status,
  }
}

/** The whole phase-one transaction. */
export async function preparePublish(
  input: PublishInput
): Promise<PublishPhaseOne> {
  return withTenant<PublishPhaseOne>(input.organisationId, async (sql) => {
    const record = await loadPublishRecord(sql, input)
    await requireLocationAccess(sql, input.session, record.location_id)
    assertDraftPublishable(record, input.expectedReviewUpdateTime)

    const canPublish = await canPublishLocation(
      sql,
      input.session,
      record.location_id
    )
    if (requiresApproval(record, canPublish)) {
      return {
        kind: "outcome",
        outcome: await requestApproval(sql, input, record.body),
      }
    }
    if (!canPublish) {
      throw new ApiError(
        403,
        "publish_permission_required",
        "You do not have publish permission for this location."
      )
    }

    const bodyHash = sha256(record.body)
    const idempotencyKey = publishIdempotencyKey({
      organisationId: input.organisationId,
      reviewId: input.reviewId,
      publishGeneration: record.publish_generation,
      bodyHash,
    })
    const existing = await findAttemptByKey(sql, {
      organisationId: input.organisationId,
      idempotencyKey,
    })
    const resolved = await resolveExistingPublishAttempt(sql, existing)
    if (resolved) return resolved

    const intent = await startPublishIntent(sql, input, record, {
      idempotencyKey,
      bodyHash,
      existing,
    })
    if (intent) return { kind: "proceed", ...intent }

    // A concurrent request (a double click, or two approvers deciding at
    // once) committed this key first. Its row is now visible, so resolve
    // against it: an in-flight winner answers `publish_in_progress`.
    const winner = await findAttemptByKey(sql, {
      organisationId: input.organisationId,
      idempotencyKey,
    })
    if (!winner) {
      throw new ApiError(409, "publish_in_progress", "A publish is in flight.")
    }
    return (
      (await resolveExistingPublishAttempt(sql, winner)) ?? {
        kind: "needs_recovery",
        attemptId: winner.id,
      }
    )
  })
}
