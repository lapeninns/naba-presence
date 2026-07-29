import "server-only"

import type { TransactionSql } from "postgres"

import { retryDelayMs } from "@/lib/domain/retry"
import { writeAudit } from "@/lib/server/audit"
import { decryptSecret, sha256 } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import {
  connectionAccessToken,
  getGoogleReview,
  GoogleMutationAmbiguousError,
  updateGoogleReply,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import {
  canPublishLocation,
  requireLocationAccess,
} from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

export async function writePublishAttemptEvent(
  sql: TransactionSql,
  input: {
    organisationId: string
    publishAttemptId: string
    eventType:
      | "started"
      | "provider_accepted"
      | "provider_rejected"
      | "retry_scheduled"
      | "ambiguity_checked"
      | "completed"
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

export function googleReplyFromReview(review: Record<string, unknown>) {
  return review.reviewReply && typeof review.reviewReply === "object"
    ? (review.reviewReply as Record<string, unknown>)
    : null
}

export function googleReplyMatches(
  review: Record<string, unknown>,
  expectedBody: string
) {
  const reply = googleReplyFromReview(review)
  return typeof reply?.comment === "string" && reply.comment === expectedBody
}

export type PublishOutcome = {
  status:
    | "published"
    | "rejected"
    | "pending"
    | "awaiting_approval"
    | "failed"
    | "ambiguous"
  googleReplyState: string | null
  attemptId: string
  reviewReplyId?: string
  idempotent?: boolean
  providerError?: {
    status: number
    code: string
    message: string
  }
}

type PublishRecord = {
  review_id: string
  google_review_name_ciphertext: Buffer
  update_time: Date
  location_id: string
  verified: boolean
  connection_id: string
  body: string
  verification_status: string
  approval_required: boolean
  publish_generation: number
}

type ExistingAttempt = {
  id: string
  status: string
  review_reply_id: string
  attempt_no: number
  next_attempt_at: Date | null
}

type AttemptRecoveryContext = {
  id: string
  status: string
  operation: "publish" | "delete"
  intended_body: string | null
  started_at: Date
  review_id: string
  review_reply_id: string
  google_review_name_ciphertext: Buffer
  google_connection_id: string
}

const IN_FLIGHT_GRACE_MS = 2 * 60 * 1000

export async function recoverAttempt(input: {
  organisationId: string
  attemptId: string
}): Promise<"succeeded" | "not_applied" | "diverged"> {
  const context = await withTenant(
    input.organisationId,
    async (sql) => {
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
    }
  )
  if (!context || !["started", "ambiguous"].includes(context.status)) {
    return "not_applied"
  }
  if (
    context.status === "started" &&
    Date.now() - context.started_at.getTime() < IN_FLIGHT_GRACE_MS
  ) {
    throw new ApiError(
      409,
      "publish_in_progress",
      "A publish is in flight."
    )
  }

  let review: Record<string, unknown>
  try {
    const accessToken = await connectionAccessToken(
      getDatabase(),
      input.organisationId,
      context.google_connection_id
    )
    review = await getGoogleReview(
      accessToken,
      decryptSecret(context.google_review_name_ciphertext),
      { timeoutMs: 15_000, maxAttempts: 1 }
    )
  } catch (error) {
    if (error instanceof GoogleMutationAmbiguousError) throw error
    throw new GoogleMutationAmbiguousError(
      error instanceof Error ? error.message : undefined
    )
  }

  const providerReply = googleReplyFromReview(review)
  const applied =
    context.operation === "delete"
      ? providerReply === null
      : context.intended_body !== null &&
        googleReplyMatches(review, context.intended_body)
  const result =
    applied
      ? "succeeded"
      : providerReply === null
        ? "not_applied"
        : "diverged"

  await withTenant(input.organisationId, async (sql) => {
    await writePublishAttemptEvent(sql, {
      organisationId: input.organisationId,
      publishAttemptId: context.id,
      eventType: "ambiguity_checked",
      payload: {
        result,
        operation: context.operation,
        providerReplyPresent: providerReply !== null,
      },
    })
    if (result === "succeeded") {
      await sql`
        update publish_attempt
        set
          status = 'succeeded',
          provider_http_status = 200,
          provider_error_code = null,
          next_attempt_at = null,
          finished_at = now()
        where id = ${context.id}
      `
      await sql`
        update review_reply
        set
          publish_status = ${
            context.operation === "delete" ? "deleted" : "published"
          },
          first_published_at = case
            when ${context.operation} = 'publish'
              then coalesce(first_published_at, now())
            else first_published_at
          end
        where id = ${context.review_reply_id}
      `
      await sql`
        update review
        set workflow_status = ${
          context.operation === "delete" ? "new" : "published"
        }
        where id = ${context.review_id}
      `
      await writePublishAttemptEvent(sql, {
        organisationId: input.organisationId,
        publishAttemptId: context.id,
        eventType: "completed",
        payload: { result },
      })
      return
    }
    if (result === "not_applied") {
      await sql`
        update publish_attempt
        set
          status = 'retryable',
          next_attempt_at = now(),
          finished_at = now()
        where id = ${context.id}
      `
      await writePublishAttemptEvent(sql, {
        organisationId: input.organisationId,
        publishAttemptId: context.id,
        eventType: "retry_scheduled",
        payload: { result },
      })
      return
    }
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
      organisationId: input.organisationId,
      publishAttemptId: context.id,
      eventType: "completed",
      payload: { result },
    })
    await writeAudit(sql, {
      organisationId: input.organisationId,
      action: "review.reply.diverged",
      subjectType: "review",
      subjectId: context.review_id,
      metadata: {
        publishAttemptId: context.id,
        operation: context.operation,
      },
    })
  })
  return result
}

type PublishPhaseOne =
  | { kind: "outcome"; outcome: PublishOutcome }
  | { kind: "needs_recovery"; attemptId: string }
  | {
      kind: "proceed"
      attemptId: string
      attemptNo: number
      reviewReplyId: string
      connectionId: string
      googleReviewName: string
      body: string
      draftId: string
      verificationStatus: string
    }

export async function executePublish(input: {
  organisationId: string
  session: Session
  reviewId: string
  draftId: string
  expectedReviewUpdateTime: string
  serverRequestId: string
}): Promise<PublishOutcome> {
  const phaseOne = await withTenant<PublishPhaseOne>(
    input.organisationId,
    async (sql) => {
      const [record] = await sql<PublishRecord[]>`
        select
          r.id::text as review_id,
          r.google_review_name_ciphertext,
          r.update_time,
          r.location_id::text as location_id,
          e.verified,
          e.google_connection_id::text as connection_id,
          d.body,
          d.verification_status,
          o.approval_required,
          coalesce(rr.publish_generation, 0) as publish_generation
        from review r
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
      await requireLocationAccess(
        sql,
        input.session,
        record.location_id
      )
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
      if (
        input.expectedReviewUpdateTime &&
        record.update_time.toISOString() !==
          input.expectedReviewUpdateTime
      ) {
        throw new ApiError(
          409,
          "review_changed",
          "The review changed after this draft was prepared."
        )
      }

      const canPublish = await canPublishLocation(
        sql,
        input.session,
        record.location_id
      )
      if (!canPublish && record.approval_required) {
        await sql`
          update review
          set workflow_status = 'awaiting_approval'
          where id = ${input.reviewId}
        `
        const [reply] = await sql<{ id: string }[]>`
          insert into review_reply (
            organisation_id,
            review_id,
            current_body,
            publish_status
          )
          values (
            ${input.organisationId},
            ${input.reviewId},
            ${record.body},
            'awaiting_approval'
          )
          on conflict (organisation_id, review_id) do update
          set
            current_body = excluded.current_body,
            publish_status = 'awaiting_approval'
          returning id::text as id
        `
        await writeAudit(sql, {
          organisationId: input.organisationId,
          actorUserId: input.session.userId,
          action: "review.approval.requested",
          subjectType: "review",
          subjectId: input.reviewId,
          requestId: input.serverRequestId,
          metadata: { draftId: input.draftId },
        })
        return {
          kind: "outcome",
          outcome: {
            status: "awaiting_approval",
            googleReplyState: null,
            attemptId: reply.id,
            reviewReplyId: reply.id,
          },
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
      const idempotencyKey = sha256(
        `${input.organisationId}:${input.reviewId}:${record.publish_generation}:${bodyHash}`
      )
      const [existing] = await sql<ExistingAttempt[]>`
        select
          id::text as id,
          status,
          review_reply_id::text as review_reply_id,
          attempt_no,
          next_attempt_at
        from publish_attempt
        where organisation_id = ${input.organisationId}
          and idempotency_key = ${idempotencyKey}
        limit 1
      `
      if (existing?.status === "succeeded") {
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
      if (existing?.status === "failed") {
        throw new ApiError(
          409,
          "previous_publish_failed",
          "The previous provider rejection is permanent. Edit the reply before retrying."
        )
      }
      if (
        existing &&
        ["started", "ambiguous"].includes(existing.status)
      ) {
        return {
          kind: "needs_recovery",
          attemptId: existing.id,
        }
      }
      if (
        existing?.next_attempt_at &&
        existing.next_attempt_at.getTime() > Date.now()
      ) {
        throw new ApiError(
          429,
          "publish_retry_not_ready",
          `Retry after ${existing.next_attempt_at.toISOString()}.`
        )
      }

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
      const [attempt] = existing
        ? await sql<{ id: string; attempt_no: number }[]>`
            update publish_attempt
            set
              status = 'started',
              attempt_no = attempt_no + 1,
              provider_http_status = null,
              provider_error_code = null,
              provider_error_body = null,
              next_attempt_at = null,
              intended_body = ${record.body},
              started_at = now(),
              finished_at = null
            where id = ${existing.id}
            returning id::text as id, attempt_no
          `
        : await sql<{ id: string; attempt_no: number }[]>`
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
              ${reply.id},
              ${input.draftId},
              ${idempotencyKey},
              ${bodyHash},
              'started',
              1,
              'publish',
              ${record.body}
            )
            returning id::text as id, attempt_no
          `
      await writePublishAttemptEvent(sql, {
        organisationId: input.organisationId,
        publishAttemptId: attempt.id,
        eventType: "started",
        payload: { attemptNo: attempt.attempt_no },
      })
      await sql`
        update review
        set workflow_status = 'publish_requested'
        where id = ${input.reviewId}
      `
      await writeAudit(sql, {
        organisationId: input.organisationId,
        actorUserId: input.session.userId,
        action: "review.reply.publish_requested",
        subjectType: "review",
        subjectId: input.reviewId,
        requestId: input.serverRequestId,
        metadata: {
          draftId: input.draftId,
          publishAttemptId: attempt.id,
          verificationStatus: record.verification_status,
        },
      })
      return {
        kind: "proceed",
        attemptId: attempt.id,
        attemptNo: attempt.attempt_no,
        reviewReplyId: reply.id,
        connectionId: record.connection_id,
        googleReviewName: decryptSecret(
          record.google_review_name_ciphertext
        ),
        body: record.body,
        draftId: input.draftId,
        verificationStatus: record.verification_status,
      }
    }
  )

  if (phaseOne.kind === "outcome") {
    return phaseOne.outcome
  }
  if (phaseOne.kind === "needs_recovery") {
    let recovery: Awaited<ReturnType<typeof recoverAttempt>>
    try {
      recovery = await recoverAttempt({
        organisationId: input.organisationId,
        attemptId: phaseOne.attemptId,
      })
    } catch (error) {
      if (error instanceof GoogleMutationAmbiguousError) {
        return {
          status: "ambiguous",
          googleReplyState: null,
          attemptId: phaseOne.attemptId,
        }
      }
      throw error
    }
    if (recovery === "diverged") {
      throw new ApiError(
        409,
        "reply_diverged",
        "The live Google reply differs from the intended reply."
      )
    }
    return executePublish(input)
  }

  let provider: Record<string, unknown> | null = null
  let providerError: unknown
  try {
    const accessToken = await connectionAccessToken(
      getDatabase(),
      input.organisationId,
      phaseOne.connectionId
    )
    provider = await updateGoogleReply(
      accessToken,
      phaseOne.googleReviewName,
      phaseOne.body,
      { timeoutMs: 20_000 }
    )
  } catch (error) {
    providerError = error
  }

  return withTenant(input.organisationId, async (sql) => {
    if (provider) {
      const googleState = String(provider.state ?? "PENDING")
      const violation = provider.policyViolation
        ? JSON.stringify(provider.policyViolation)
        : null
      const publishStatus =
        googleState === "REJECTED" ? "rejected" : "published"
      await sql`
        update review_reply
        set
          google_reply_state = ${googleState},
          google_policy_violation = ${violation},
          google_reply_updated_at = ${
            provider.updateTime ? String(provider.updateTime) : new Date()
          },
          publish_status = ${publishStatus},
          first_published_at = coalesce(first_published_at, now())
        where id = ${phaseOne.reviewReplyId}
      `
      await sql`
        update publish_attempt
        set
          status = 'succeeded',
          provider_http_status = 200,
          next_attempt_at = null,
          finished_at = now()
        where id = ${phaseOne.attemptId}
      `
      await writePublishAttemptEvent(sql, {
        organisationId: input.organisationId,
        publishAttemptId: phaseOne.attemptId,
        eventType:
          googleState === "REJECTED"
            ? "provider_rejected"
            : "provider_accepted",
        payload: { googleReplyState: googleState },
      })
      await writePublishAttemptEvent(sql, {
        organisationId: input.organisationId,
        publishAttemptId: phaseOne.attemptId,
        eventType: "completed",
        payload: { publishStatus },
      })
      await sql`
        update review
        set workflow_status = ${
          googleState === "REJECTED" ? "rejected" : "published"
        }
        where id = ${input.reviewId}
      `
      await writeAudit(sql, {
        organisationId: input.organisationId,
        actorUserId: input.session.userId,
        action:
          googleState === "REJECTED"
            ? "review.reply.rejected"
            : "review.reply.published",
        subjectType: "review",
        subjectId: input.reviewId,
        requestId: input.serverRequestId,
        metadata: {
          draftId: phaseOne.draftId,
          publishAttemptId: phaseOne.attemptId,
          googleReplyState: googleState,
          verificationStatus: phaseOne.verificationStatus,
        },
      })
      return {
        status: publishStatus,
        googleReplyState: googleState,
        attemptId: phaseOne.attemptId,
        reviewReplyId: phaseOne.reviewReplyId,
      } as PublishOutcome
    }

    const ambiguous =
      providerError instanceof GoogleMutationAmbiguousError
    const retryable =
      providerError instanceof ApiError && providerError.status === 429
    const failureStatus = ambiguous
      ? "ambiguous"
      : retryable
        ? "retryable"
        : "failed"
    const nextAttemptAt = retryable
      ? new Date(Date.now() + retryDelayMs(phaseOne.attemptNo))
      : null
    const errorStatus =
      providerError instanceof ApiError ? providerError.status : 502
    const errorCode =
      providerError instanceof ApiError
        ? providerError.code
        : "network_error"
    const errorMessage =
      providerError instanceof Error
        ? providerError.message
        : "Google publish failed."
    await sql`
      update publish_attempt
      set
        status = ${failureStatus},
        provider_http_status = ${
          providerError instanceof ApiError
            ? providerError.status
            : null
        },
        provider_error_code = ${errorCode},
        next_attempt_at = ${nextAttemptAt},
        finished_at = now()
      where id = ${phaseOne.attemptId}
    `
    await writePublishAttemptEvent(sql, {
      organisationId: input.organisationId,
      publishAttemptId: phaseOne.attemptId,
      eventType: retryable
        ? "retry_scheduled"
        : "provider_rejected",
      payload: {
        code: errorCode,
        nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
      },
    })
    if (!ambiguous && !retryable) {
      await sql`
        update review_reply
        set publish_status = 'failed'
        where id = ${phaseOne.reviewReplyId}
      `
      await sql`
        update review
        set workflow_status = 'failed'
        where id = ${input.reviewId}
      `
    }
    await writeAudit(sql, {
      organisationId: input.organisationId,
      actorUserId: input.session.userId,
      action: "review.reply.publish_failed",
      subjectType: "review",
      subjectId: input.reviewId,
      requestId: input.serverRequestId,
      metadata: {
        publishAttemptId: phaseOne.attemptId,
        failureStatus,
        nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
      },
    })
    return {
      status: ambiguous ? "ambiguous" : "failed",
      googleReplyState: null,
      attemptId: phaseOne.attemptId,
      reviewReplyId: phaseOne.reviewReplyId,
      providerError: {
        status: errorStatus,
        code: errorCode,
        message: errorMessage,
      },
    } as PublishOutcome
  })
}
