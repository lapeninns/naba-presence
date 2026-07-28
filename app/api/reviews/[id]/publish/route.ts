import { NextResponse } from "next/server"
import { z } from "zod"

import { retryDelayMs } from "@/lib/domain/retry"
import { writeAudit } from "@/lib/server/audit"
import { decryptSecret, sha256 } from "@/lib/server/crypto"
import { withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import {
  connectionAccessToken,
  getGoogleReview,
  GoogleMutationAmbiguousError,
  updateGoogleReply,
} from "@/lib/server/google"
import { ApiError, apiError, requestId } from "@/lib/server/http"
import {
  canPublishLocation,
  requireLocationAccess,
} from "@/lib/server/permissions"
import {
  googleReplyFromReview,
  googleReplyMatches,
  writePublishAttemptEvent,
} from "@/lib/server/publishing"
import { requireSession } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

const inputSchema = z.object({
  draftId: z.uuid(),
  expectedReviewUpdateTime: z.iso.datetime().optional(),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession()
    if (!getServerEnv().PUBLISH_ENABLED) {
      throw new ApiError(
        503,
        "publishing_paused",
        "Publishing is temporarily paused."
      )
    }
    const { id } = await context.params
    const input = inputSchema.parse(await request.json())
    const result = await withTenant(session.organisationId, async (sql) => {
      const [record] = await sql<
        {
          review_id: string
          google_review_name_ciphertext: Buffer
          update_time: Date
          location_id: string
          verified: boolean
          connection_id: string
          body: string
          verification_status: string
          approval_required: boolean
        }[]
      >`
        select
          r.id::text as review_id,
          r.google_review_name_ciphertext,
          r.update_time,
          r.location_id::text as location_id,
          e.verified,
          e.google_connection_id::text as connection_id,
          d.body,
          d.verification_status,
          o.approval_required
        from review r
        join external_location e on e.id = r.external_location_id
        join draft d on d.review_id = r.id
        join organisation o on o.id = r.organisation_id
        where r.id = ${id}
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
      await requireLocationAccess(sql, session, record.location_id)
      const googleReviewName = decryptSecret(
        record.google_review_name_ciphertext
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
        record.update_time.toISOString() !== input.expectedReviewUpdateTime
      ) {
        throw new ApiError(
          409,
          "review_changed",
          "The review changed after this draft was prepared."
        )
      }
      const canPublish = await canPublishLocation(
        sql,
        session,
        record.location_id
      )
      if (!canPublish && record.approval_required) {
        await sql`
          update review set workflow_status = 'awaiting_approval'
          where id = ${id}
        `
        const [reply] = await sql<{ id: string }[]>`
          insert into review_reply (
            organisation_id,
            review_id,
            current_body,
            publish_status
          )
          values (
            ${session.organisationId},
            ${id},
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
          organisationId: session.organisationId,
          actorUserId: session.userId,
          action: "review.approval.requested",
          subjectType: "review",
          subjectId: id,
          requestId: requestId(request),
          metadata: { draftId: input.draftId },
        })
        return {
          reviewReplyId: reply.id,
          status: "awaiting_approval",
          googleReplyState: null,
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
        `${session.organisationId}:${id}:${bodyHash}`
      )
      const [existing] = await sql<
        {
          id: string
          status: string
          review_reply_id: string
          attempt_no: number
          next_attempt_at: Date | null
        }[]
      >`
        select
          id::text as id,
          status,
          review_reply_id::text as review_reply_id,
          attempt_no,
          next_attempt_at
        from publish_attempt
        where idempotency_key = ${idempotencyKey}
        limit 1
      `
      if (existing?.status === "succeeded") {
        const [reply] = await sql`
          select
            id::text as "reviewReplyId",
            publish_status as status,
            google_reply_state as "googleReplyState"
          from review_reply
          where id = ${existing.review_reply_id}
        `
        return { ...reply, publishAttemptId: existing.id, idempotent: true }
      }
      if (existing?.status === "failed") {
        throw new ApiError(
          409,
          "previous_publish_failed",
          "The previous provider rejection is permanent. Edit the reply before retrying."
        )
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
          ${session.organisationId},
          ${id},
          ${record.body},
          'accepted',
          ${session.userId}
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
              attempt_no
            )
            values (
              ${session.organisationId},
              ${reply.id},
              ${input.draftId},
              ${idempotencyKey},
              ${bodyHash},
              'started',
              1
            )
            returning id::text as id, attempt_no
          `
      await writePublishAttemptEvent(sql, {
        organisationId: session.organisationId,
        publishAttemptId: attempt.id,
        eventType: "started",
        payload: { attemptNo: attempt.attempt_no },
      })
      await sql`
        update review set workflow_status = 'publish_requested'
        where id = ${id}
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "review.reply.publish_requested",
        subjectType: "review",
        subjectId: id,
        requestId: requestId(request),
        metadata: {
          draftId: input.draftId,
          publishAttemptId: attempt.id,
          verificationStatus: record.verification_status,
        },
      })
      const accessToken = await connectionAccessToken(sql, record.connection_id)
      let provider: Record<string, unknown> | null = null

      if (existing?.status === "ambiguous") {
        const currentReview = await getGoogleReview(
          accessToken,
          googleReviewName
        )
        const matched = googleReplyMatches(currentReview, record.body)
        await writePublishAttemptEvent(sql, {
          organisationId: session.organisationId,
          publishAttemptId: attempt.id,
          eventType: "ambiguity_checked",
          payload: { matchedBeforeRetry: matched },
        })
        if (matched) provider = googleReplyFromReview(currentReview)
      }

      if (!provider) {
        try {
          provider = await updateGoogleReply(
            accessToken,
            googleReviewName,
            record.body
          )
        } catch (error) {
          if (error instanceof GoogleMutationAmbiguousError) {
            try {
              const currentReview = await getGoogleReview(
                accessToken,
                googleReviewName
              )
              const matched = googleReplyMatches(currentReview, record.body)
              await writePublishAttemptEvent(sql, {
                organisationId: session.organisationId,
                publishAttemptId: attempt.id,
                eventType: "ambiguity_checked",
                payload: { matchedAfterTimeout: matched },
              })
              if (matched) provider = googleReplyFromReview(currentReview)
            } catch {
              // The attempt remains ambiguous and will be checked before retry.
            }
          }
          if (!provider) {
            const retryable =
              error instanceof GoogleMutationAmbiguousError ||
              (error instanceof ApiError &&
                (error.status === 429 || error.status >= 500))
            const failureStatus =
              error instanceof GoogleMutationAmbiguousError
                ? "ambiguous"
                : retryable
                  ? "retryable"
                  : "failed"
            const nextAttemptAt = retryable
              ? new Date(Date.now() + retryDelayMs(attempt.attempt_no))
              : null
            await sql`
              update publish_attempt
              set
                status = ${failureStatus},
                provider_http_status = ${
                  error instanceof ApiError ? error.status : null
                },
                provider_error_code = ${
                  error instanceof ApiError ? error.code : "network_error"
                },
                next_attempt_at = ${nextAttemptAt},
                finished_at = now()
              where id = ${attempt.id}
            `
            await writePublishAttemptEvent(sql, {
              organisationId: session.organisationId,
              publishAttemptId: attempt.id,
              eventType: retryable ? "retry_scheduled" : "provider_rejected",
              payload: {
                code: error instanceof ApiError ? error.code : "network_error",
                nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
              },
            })
            await sql`
              update review_reply set publish_status = 'failed'
              where id = ${reply.id}
            `
            await sql`
              update review set workflow_status = 'failed'
              where id = ${id}
            `
            await writeAudit(sql, {
              organisationId: session.organisationId,
              actorUserId: session.userId,
              action: "review.reply.publish_failed",
              subjectType: "review",
              subjectId: id,
              requestId: requestId(request),
              metadata: {
                publishAttemptId: attempt.id,
                failureStatus,
                nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
              },
            })
            return {
              providerError: {
                status: error instanceof ApiError ? error.status : 502,
                code: error instanceof ApiError ? error.code : "network_error",
                message:
                  error instanceof Error
                    ? error.message
                    : "Google publish failed.",
              },
            }
          }
        }
      }

      const googleState = String(provider?.state ?? "PENDING")
      const violation = provider?.policyViolation
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
            provider?.updateTime ? String(provider.updateTime) : new Date()
          },
          publish_status = ${publishStatus}
        where id = ${reply.id}
      `
      await sql`
        update publish_attempt
        set
          status = 'succeeded',
          provider_http_status = 200,
          next_attempt_at = null,
          finished_at = now()
        where id = ${attempt.id}
      `
      await writePublishAttemptEvent(sql, {
        organisationId: session.organisationId,
        publishAttemptId: attempt.id,
        eventType:
          googleState === "REJECTED"
            ? "provider_rejected"
            : "provider_accepted",
        payload: { googleReplyState: googleState },
      })
      await writePublishAttemptEvent(sql, {
        organisationId: session.organisationId,
        publishAttemptId: attempt.id,
        eventType: "completed",
        payload: { publishStatus },
      })
      await sql`
        update review
        set workflow_status = ${
          googleState === "REJECTED" ? "rejected" : "published"
        }
        where id = ${id}
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action:
          googleState === "REJECTED"
            ? "review.reply.rejected"
            : "review.reply.published",
        subjectType: "review",
        subjectId: id,
        requestId: requestId(request),
        metadata: {
          draftId: input.draftId,
          publishAttemptId: attempt.id,
          googleReplyState: googleState,
          verificationStatus: record.verification_status,
        },
      })
      return {
        reviewReplyId: reply.id,
        publishAttemptId: attempt.id,
        status: publishStatus,
        googleReplyState: googleState,
      }
    })
    if ("providerError" in result) {
      const providerError = result.providerError
      if (!providerError) {
        throw new ApiError(
          502,
          "google_publish_failed",
          "Google did not confirm the reply."
        )
      }
      throw new ApiError(
        providerError.status,
        providerError.code,
        providerError.message
      )
    }
    return NextResponse.json(result, {
      status: result.status === "awaiting_approval" ? 202 : 200,
    })
  } catch (error) {
    return apiError(error)
  }
}
