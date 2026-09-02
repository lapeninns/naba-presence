import { NextResponse } from "next/server"
import type { TransactionSql } from "postgres"

import {
  privacyRequestCreateSchema,
  privacyRequestUpdateSchema,
  type PrivacyRequestType,
} from "@/lib/contracts/privacy"
import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { executeReplyDelete } from "@/lib/server/publishing"
import { supersedeAttempts } from "@/lib/server/publishing/attempt"
import { route } from "@/lib/server/route"
import type { Session } from "@/lib/server/session"

export const runtime = "nodejs"
// The erasure branch withdraws replies at Google, one provider round trip per
// matched reply, so this handler is as long-running as the reply delete route.
export const maxDuration = 60

/** The two states a request can still be acted on from. */
const OPEN_STATUSES = ["pending", "in_progress"]

/**
 * Mirrors `enforce_privacy_request_transition`
 * (0041_privacy_fulfilment.sql). The trigger is the invariant; this is the
 * 409 an operator sees instead of a 500 raised out of plpgsql.
 */
const ALLOWED_STATUS_MOVES: Record<string, readonly string[]> = {
  pending: ["pending", "in_progress", "completed", "rejected"],
  in_progress: ["in_progress", "completed", "rejected"],
}

/**
 * `review_reply.publish_status` values that mean nothing is left at Google.
 * Everything else -- including `awaiting_approval` and `accepted`, which
 * `executeReplyDelete` withdraws locally -- goes through the delete pipeline.
 * This is the same predicate `loadDeleteRecord` answers 404 to.
 */
const WITHDRAWN_REPLY_STATUSES = new Set(["deleted", "not_published"])

/**
 * What `draft.body` becomes on erasure. The column is `not null`, so the
 * reviewer's name is replaced rather than dropped.
 */
const ERASED_DRAFT_BODY = "[Removed at the data subject's request]"

function assertOpen(status: string) {
  if (!OPEN_STATUSES.includes(status)) {
    throw new ApiError(
      409,
      "privacy_request_resolved",
      "This privacy request has already been resolved."
    )
  }
}

type LockedRequest = {
  id: string
  requestType: PrivacyRequestType
  status: string
  subjectReference: string
  /**
   * Reviews an earlier fulfil already scrubbed and could not withdraw from
   * Google. They are matched by id on the retry because the subject
   * reference no longer finds them: the first pass replaced the display name
   * this request was logged against.
   */
  pendingReviewIds: string[]
}

/**
 * Read the request under a row lock. Both PATCH branches take this: without
 * it a fulfil and a reject racing on the same row both re-evaluate `where id
 * = ...` under READ COMMITTED, both still match, and the loser's status wins
 * over work the winner already did.
 */
async function lockRequest(
  sql: TransactionSql,
  id: string
): Promise<LockedRequest> {
  const [privacyRequest] = await sql<LockedRequest[]>`
    select
      id::text as id,
      request_type as "requestType",
      status,
      subject_reference as "subjectReference",
      pending_review_ids::text[] as "pendingReviewIds"
    from privacy_request
    where id = ${id}
    for update
  `
  if (!privacyRequest) {
    throw new ApiError(
      404,
      "privacy_request_not_found",
      "Privacy request not found."
    )
  }
  return privacyRequest
}

/** The PATCH response projection, shared by all four resolution updates. */
const RESOLUTION_COLUMNS = `
  id::text as id, request_type as "requestType", status,
  subject_reference as "subjectReference",
  resolution_note as "resolutionNote", resolved_at as "resolvedAt"
`

type ErasureScrub = {
  reviewsAffected: number
  mediaRemoved: number
  draftsRedacted: number
  repliesRedacted: number
  attemptBodiesRedacted: number
  /** Reviews whose reply still has to be withdrawn at Google. */
  withdrawals: string[]
}

/**
 * Drop the intended body from every settled attempt for these replies.
 *
 * An unsettled row keeps its body on purpose: `decideRecovery` compares
 * `intended_body` with what Google actually holds, so scrubbing a `started`
 * or `ambiguous` attempt mid-flight would turn a recoverable write into an
 * unresolvable one. Those rows are scrubbed on the second pass, once the
 * withdrawal has forced them through recovery.
 */
async function scrubAttemptBodies(sql: TransactionSql, replyIds: string[]) {
  const scrubbed = await sql`
    update publish_attempt
    set intended_body = null
    where review_reply_id in ${sql(replyIds)}
      and intended_body is not null
      and status not in ('started', 'ambiguous')
    returning id
  `
  return scrubbed.count
}

/**
 * The local half of an erasure.
 *
 * Beyond the review row, the reviewer's name lives in every derived body:
 * `lib/domain/rating-only.ts` greets the reviewer by name, and that string is
 * stored in `draft.body`, copied into `review_reply.current_body` by
 * `startPublishIntent` and into `publish_attempt.intended_body`. None of
 * those three tables is touched by the retention sweep, so an erasure that
 * only anonymises `review` leaves the name readable indefinitely -- and
 * readable back out through the subject export.
 */
async function eraseReviews(
  sql: TransactionSql,
  organisationId: string,
  reviewIds: string[]
): Promise<ErasureScrub> {
  const media = await sql`
    delete from review_media_item
    where review_id in ${sql(reviewIds)}
    returning id
  `
  // `erased_at` is the marker `upsertGoogleReview` keys its re-ingestion
  // guard on (0030_review_erasure_and_checkpoints.sql); without it the next
  // reconcile tick writes every field below straight back. coalesce keeps the
  // first erasure's timestamp when a request is fulfilled more than once.
  const reviews = await sql`
    update review
    set
      reviewer_display_name = 'Removed reviewer',
      reviewer_profile_photo_url = null,
      review_text = null,
      raw_payload = null,
      erased_at = coalesce(erased_at, now())
    where id in ${sql(reviewIds)}
    returning id
  `
  const drafts = await sql`
    update draft
    set
      body = ${ERASED_DRAFT_BODY},
      body_bytes = ${Buffer.byteLength(ERASED_DRAFT_BODY)}
    where review_id in ${sql(reviewIds)}
      and body <> ${ERASED_DRAFT_BODY}
    returning id
  `
  const counts = {
    reviewsAffected: reviews.count,
    mediaRemoved: media.count,
    draftsRedacted: drafts.count,
  }

  const replies = await sql<
    { id: string; reviewId: string; publishStatus: string }[]
  >`
    select
      id::text as id,
      review_id::text as "reviewId",
      publish_status as "publishStatus"
    from review_reply
    where review_id in ${sql(reviewIds)}
    order by review_id
  `
  if (replies.length === 0) {
    return {
      ...counts,
      repliesRedacted: 0,
      attemptBodiesRedacted: 0,
      withdrawals: [],
    }
  }
  const replyIds = replies.map(({ id }) => id)

  // A `retryable` attempt is armed work the runner replays verbatim on a
  // later tick. Retire it here: left armed it would either republish the
  // erased reviewer's name or fail the tick on a null intended_body.
  const queued = await sql<{ id: string }[]>`
    select id::text as id
    from publish_attempt
    where review_reply_id in ${sql(replyIds)}
      and status = 'retryable'
  `
  await supersedeAttempts(sql, {
    organisationId,
    attemptIds: queued.map(({ id }) => id),
    reason: "subject_erasure",
  })
  const attemptBodiesRedacted = await scrubAttemptBodies(sql, replyIds)
  const redacted = await sql`
    update review_reply
    set current_body = null
    where id in ${sql(replyIds)}
      and current_body is not null
    returning id
  `
  return {
    ...counts,
    repliesRedacted: redacted.count,
    attemptBodiesRedacted,
    withdrawals: replies
      .filter((reply) => !WITHDRAWN_REPLY_STATUSES.has(reply.publishStatus))
      .map((reply) => reply.reviewId),
  }
}

/**
 * Withdraw the replies an erasure matched, one provider round trip each.
 *
 * Deliberately outside the erasure transaction -- a provider call never runs
 * inside an open tenant transaction -- and outside its failure boundary: a
 * reply Google refuses to drop must not roll back the local scrub. Each
 * failure is collected instead, and leaves the request open for a retry.
 */
async function withdrawReplies(input: {
  organisationId: string
  session: Session
  requestId: string
  reviewIds: string[]
}) {
  const withdrawn: string[] = []
  const pending: { reviewId: string; code: string }[] = []
  // Withdrawing a reply is a Google write, and the manual delete route pauses
  // on the same flag. Nothing is lost by honouring it: the local scrub is
  // already committed and the request stays open until publishing resumes.
  if (!getServerEnv().PUBLISH_ENABLED) {
    return {
      withdrawn,
      pending: input.reviewIds.map((reviewId) => ({
        reviewId,
        code: "publishing_paused",
      })),
    }
  }
  for (const reviewId of input.reviewIds) {
    try {
      const outcome = await executeReplyDelete({
        organisationId: input.organisationId,
        session: input.session,
        reviewId,
        requestId: input.requestId,
      })
      // An ambiguous delete is Google not confirming; the reply may still be
      // live, so it is not a withdrawal yet.
      if (outcome.status === "ambiguous") {
        pending.push({ reviewId, code: "google_mutation_ambiguous" })
      } else {
        withdrawn.push(reviewId)
      }
    } catch (error) {
      pending.push({
        reviewId,
        code:
          error instanceof ApiError ? error.code : "google_reply_delete_failed",
      })
    }
  }
  return { withdrawn, pending }
}

export const GET = route({
  roles: ["owner", "admin"],
  handler: async ({ tenant }) => {
    // Open requests first, the closest to their statutory deadline at the
    // top, then resolved ones by recency. Ordering is the only fulfilment
    // signal the console has: nothing else tells an owner which of 500 rows
    // is about to breach.
    const requests = await tenant(
      (sql) => sql`
        select
          id::text as id,
          request_type as "requestType",
          status,
          subject_reference as "subjectReference",
          reason,
          requested_by::text as "requestedBy",
          resolved_by::text as "resolvedBy",
          resolution_note as "resolutionNote",
          resolved_at as "resolvedAt",
          due_at as "dueAt",
          (status in ('pending', 'in_progress') and due_at < now()) as overdue,
          created_at as "createdAt",
          updated_at as "updatedAt"
        from privacy_request
        order by
          case when status in ('pending', 'in_progress') then 0 else 1 end,
          case when status in ('pending', 'in_progress') then due_at end,
          created_at desc
        limit 500
      `
    )
    return { requests }
  },
})

export const POST = route({
  roles: ["owner", "admin"],
  body: privacyRequestCreateSchema,
  handler: async ({
    session,
    body: input,
    requestId,
    clientRequestId,
    tenant,
  }) => {
    const privacyRequest = await tenant(async (sql) => {
      const [row] = await sql`
        insert into privacy_request (
          organisation_id,
          request_type,
          subject_reference,
          reason,
          requested_by
        )
        values (
          ${session.organisationId},
          ${input.requestType},
          ${input.subjectReference},
          ${input.reason ?? null},
          ${session.userId}
        )
        returning
          id::text as id,
          request_type as "requestType",
          status,
          subject_reference as "subjectReference",
          due_at as "dueAt",
          created_at as "createdAt"
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "privacy.request.created",
        subjectType: "privacy_request",
        subjectId: String(row.id),
        requestId,
        metadata: {
          requestType: input.requestType,
          subjectReference: input.subjectReference,
          dueAt: row.dueAt,
          clientRequestId,
        },
      })
      return row
    })
    return NextResponse.json({ request: privacyRequest }, { status: 201 })
  },
})

export const PATCH = route({
  roles: ["owner"],
  body: privacyRequestUpdateSchema,
  handler: async ({
    session,
    body: input,
    requestId,
    clientRequestId,
    tenant,
  }) => {
    if ("action" in input) {
      const result = await tenant(async (sql) => {
        const privacyRequest = await lockRequest(sql, input.id)
        // Without this the fulfil branch would erase for a request already
        // rejected, and flip it to completed.
        assertOpen(privacyRequest.status)
        // The id arm is what makes a parked erasure retryable: the scrub
        // this request already committed replaced the display name the other
        // arms match on, so a second fulfil would otherwise find nothing and
        // complete with the reply still live at Google. Empty for every
        // request that has not been parked, and `= any('{}')` matches
        // nothing.
        const matches = await sql<{ id: string }[]>`
          select id::text as id
          from review
          where id = any(${privacyRequest.pendingReviewIds}::uuid[])
            or google_review_id_hash =
              ${sha256(privacyRequest.subjectReference)}
            or google_review_name_hash =
              ${sha256(privacyRequest.subjectReference)}
            or lower(coalesce(reviewer_display_name, '')) =
              lower(${privacyRequest.subjectReference})
          order by id
        `
        const reviewIds = matches.map(({ id }) => id)
        if (privacyRequest.requestType === "erasure" && reviewIds.length) {
          const holds = await sql<{ reviewId: string }[]>`
            select review_id::text as "reviewId"
            from legal_hold
            where review_id in ${sql(reviewIds)}
              and released_at is null
            order by review_id
          `
          if (holds.length) {
            return {
              blocked: true as const,
              holds: holds.map(({ reviewId }) => reviewId),
            }
          }
        }

        let scrub: ErasureScrub | null = null
        let reviewsAffected = 0
        if (privacyRequest.requestType === "erasure" && reviewIds.length) {
          scrub = await eraseReviews(sql, session.organisationId, reviewIds)
          reviewsAffected = scrub.reviewsAffected
        } else if (
          privacyRequest.requestType === "restriction" &&
          reviewIds.length
        ) {
          // coalesce for the same reason as `erased_at`: the date processing
          // was restricted is the first request's, and a second request
          // naming the same subject must not move it forward.
          const reviews = await sql`
            update review
            set restricted_at = coalesce(restricted_at, now())
            where id in ${sql(reviewIds)}
            returning id
          `
          reviewsAffected = reviews.count
        }
        // Access is fulfilled by the existing export route. Rectification
        // records the verified resolution without mutating provider data.
        await writeAudit(sql, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          action: "privacy.request.fulfilled",
          subjectType: "privacy_request",
          subjectId: input.id,
          requestId,
          metadata: {
            requestType: privacyRequest.requestType,
            reviewsMatched: reviewIds.length,
            reviewsAffected,
            mediaRemoved: scrub?.mediaRemoved ?? 0,
            draftsRedacted: scrub?.draftsRedacted ?? 0,
            repliesRedacted: scrub?.repliesRedacted ?? 0,
            attemptBodiesRedacted: scrub?.attemptBodiesRedacted ?? 0,
            repliesToWithdraw: scrub?.withdrawals.length ?? 0,
            resolutionNote: input.resolutionNote,
            clientRequestId,
          },
        })
        const withdrawals = scrub?.withdrawals ?? []
        // A live reply still greets the subject by name on Google, so the
        // request is not complete until it is gone. Park it `in_progress`
        // and let the provider phase below decide.
        const [row] = withdrawals.length
          ? await sql`
              update privacy_request
              set
                status = 'in_progress',
                pending_review_ids = ${withdrawals}::uuid[]
              where id = ${input.id}
              returning ${sql.unsafe(RESOLUTION_COLUMNS)}
            `
          : await sql`
              update privacy_request
              set
                status = 'completed',
                pending_review_ids = '{}',
                resolution_note = ${input.resolutionNote},
                resolved_by = ${session.userId},
                resolved_at = now()
              where id = ${input.id}
              returning ${sql.unsafe(RESOLUTION_COLUMNS)}
            `
        return { blocked: false as const, request: row, withdrawals }
      })
      if (result.blocked) {
        return NextResponse.json(
          {
            error: "privacy_legal_hold",
            message: "Matching reviews are protected by an active legal hold.",
            holds: result.holds,
          },
          { status: 409 }
        )
      }
      if (result.withdrawals.length === 0) return { request: result.request }

      const removal = await withdrawReplies({
        organisationId: session.organisationId,
        session,
        requestId,
        reviewIds: result.withdrawals,
      })
      const settled = await tenant(async (sql) => {
        // The withdrawal forced every in-flight attempt through recovery, so
        // the bodies phase one had to leave alone can go now.
        const replies = await sql<{ id: string }[]>`
          select rr.id::text as id
          from review_reply rr
          where rr.review_id in ${sql(result.withdrawals)}
        `
        const attemptBodiesRedacted = replies.length
          ? await scrubAttemptBodies(
              sql,
              replies.map(({ id }) => id)
            )
          : 0
        await writeAudit(sql, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          action: "privacy.request.replies_withdrawn",
          subjectType: "privacy_request",
          subjectId: input.id,
          requestId,
          metadata: {
            withdrawn: removal.withdrawn.length,
            pending: removal.pending,
            attemptBodiesRedacted,
            clientRequestId,
          },
        })
        if (removal.pending.length) return null
        const [row] = await sql`
          update privacy_request
          set
            status = 'completed',
            pending_review_ids = '{}',
            resolution_note = ${input.resolutionNote},
            resolved_by = ${session.userId},
            resolved_at = now()
          where id = ${input.id}
            and status in ('pending', 'in_progress')
          returning ${sql.unsafe(RESOLUTION_COLUMNS)}
        `
        return row ?? null
      })
      if (!settled) {
        // The local scrub is committed either way; the request stays open so
        // the operator can retry the withdrawal, which is idempotent.
        return NextResponse.json(
          {
            error: "privacy_reply_withdraw_failed",
            message:
              "The reply could not be withdrawn from Google. The request stays open.",
            pending: removal.pending,
          },
          { status: 409 }
        )
      }
      return { request: settled }
    }
    const privacyRequest = await tenant(async (sql) => {
      const current = await lockRequest(sql, input.id)
      assertOpen(current.status)
      if (!ALLOWED_STATUS_MOVES[current.status].includes(input.status)) {
        throw new ApiError(
          409,
          "privacy_request_transition_invalid",
          "A privacy request cannot move back to that status."
        )
      }
      const [row] = await sql`
        update privacy_request
        set
          status = ${input.status},
          resolution_note = ${input.resolutionNote},
          resolved_by = case
            when ${input.status} in ('completed', 'rejected')
              -- Cast required: the branch is a text parameter and the ELSE is
              -- an untyped NULL, so the CASE resolves to text and cannot be
              -- assigned to a uuid column. The plain assignments elsewhere in
              -- this file infer their type from the target and need no cast.
              then ${session.userId}::uuid
            else null
          end,
          resolved_at = case
            when ${input.status} in ('completed', 'rejected') then now()
            else null
          end
        where id = ${input.id}
        returning ${sql.unsafe(RESOLUTION_COLUMNS)}
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "privacy.request.status_changed",
        subjectType: "privacy_request",
        subjectId: input.id,
        requestId,
        metadata: {
          fromStatus: current.status,
          status: input.status,
          resolutionNote: input.resolutionNote,
          clientRequestId,
        },
      })
      return row
    })
    return { request: privacyRequest }
  },
})
