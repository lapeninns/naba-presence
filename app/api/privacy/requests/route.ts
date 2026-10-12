import { NextResponse } from "next/server"
import type { TransactionSql } from "postgres"

import {
  privacyRequestCreateSchema,
  privacyRequestUpdateSchema,
  type PrivacyRequestType,
} from "@/lib/contracts/privacy"
import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { ApiError } from "@/lib/server/http"
import {
  eraseReviews,
  OPEN_STATUSES,
  PRIVACY_WITHDRAWAL_PARK_GRACE,
  RESOLUTION_COLUMNS,
  settleWithdrawal,
  withdrawReplies,
  type ErasureScrub,
} from "@/lib/server/privacy/fulfil"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
// The erasure branch withdraws replies at Google, one provider round trip per
// matched reply, so this handler is as long-running as the reply delete route.
export const maxDuration = 60

/**
 * How long the inline withdrawal round may keep starting provider calls.
 * It leaves room under `maxDuration` for the last call to time out and the
 * round to settle; replies it has no time for are deferred to the job tick.
 */
const INLINE_WITHDRAWAL_BUDGET_MS = 40_000

/**
 * Mirrors `enforce_privacy_request_transition`
 * (0041_privacy_fulfilment.sql). The trigger is the invariant; this is the
 * 409 an operator sees instead of a 500 raised out of plpgsql.
 */
const ALLOWED_STATUS_MOVES: Record<string, readonly string[]> = {
  pending: ["pending", "in_progress", "completed", "rejected"],
  in_progress: ["in_progress", "completed", "rejected"],
}

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

/**
 * An erasure parked with replies still to withdraw and no automatic retry
 * coming: the budget is spent, the owner it ran as lost access, or a legal
 * hold landed. A constant fragment, so sql.unsafe carries no input.
 */
const WITHDRAWAL_STALLED_SQL = `(
  status = 'in_progress'
  and cardinality(pending_review_ids) > 0
  and next_attempt_at is null
)`

export const GET = route({
  roles: ["owner", "admin"],
  handler: async ({ tenant }) => {
    // Stalled withdrawals first, then open requests, the closest to their
    // statutory deadline at the top, then resolved ones by recency. Ordering is the only fulfilment
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
          ${sql.unsafe(WITHDRAWAL_STALLED_SQL)} as "withdrawalStalled",
          -- A stalled withdrawal is overdue whatever its deadline: nothing
          -- will finish it before a person acts.
          (
            (status in ('pending', 'in_progress') and due_at < now())
            or ${sql.unsafe(WITHDRAWAL_STALLED_SQL)}
          ) as overdue,
          withdrawal_attempts as "withdrawalAttempts",
          next_attempt_at as "nextAttemptAt",
          last_error_code as "lastErrorCode",
          created_at as "createdAt",
          updated_at as "updatedAt"
        from privacy_request
        order by
          case
            when ${sql.unsafe(WITHDRAWAL_STALLED_SQL)} then 0
            when status in ('pending', 'in_progress') then 1
            else 2
          end,
          case when status in ('pending', 'in_progress') then due_at end,
          created_at desc
        limit 500
      `
    )
    return { requests }
  },
})

export const POST = route({
  mfa: "step_up",
  entitlement: "exempt",
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
  mfa: "step_up",
  entitlement: "exempt",
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
        // and let the provider phase below decide. The owner fulfilling it
        // becomes the actor the background tick withdraws as, and a fulfil
        // by hand is a human taking it over, so the retry budget restarts.
        // The first automatic round waits out the inline one: it only runs
        // if this process dies before settling.
        const [row] = withdrawals.length
          ? await sql`
              update privacy_request
              set
                status = 'in_progress',
                pending_review_ids = ${withdrawals}::uuid[],
                resolution_note = ${input.resolutionNote},
                withdrawal_actor_id = ${session.userId},
                withdrawal_attempts = 0,
                next_attempt_at =
                  now() + ${PRIVACY_WITHDRAWAL_PARK_GRACE}::interval,
                last_error_code = null
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
        actor: session,
        requestId,
        reviewIds: result.withdrawals,
        deadline: Date.now() + INLINE_WITHDRAWAL_BUDGET_MS,
      })
      const settled = await settleWithdrawal({
        organisationId: session.organisationId,
        privacyRequestId: input.id,
        actorUserId: session.userId,
        requestId,
        clientRequestId,
        source: "fulfil",
        reviewIds: result.withdrawals,
        removal,
      })
      if (settled.outcome === "resolved_elsewhere") {
        // A background round claimed before this fulfil can finish the
        // erasure while the inline round runs. The owner asked for exactly
        // that, so it is a success, not a conflict.
        const [current] = await tenant(
          (sql) => sql`
            select ${sql.unsafe(RESOLUTION_COLUMNS)}
            from privacy_request
            where id = ${input.id}
          `
        )
        if (current?.status === "completed") return { request: current }
        throw new ApiError(
          409,
          "privacy_request_resolved",
          "This privacy request has already been resolved."
        )
      }
      if (settled.outcome !== "completed") {
        // The local scrub is committed either way; the request stays open and
        // the job tick retries the withdrawal with backoff
        // (lib/server/privacy/withdrawals.ts). Fulfilling again by hand is
        // still allowed and idempotent.
        return NextResponse.json(
          {
            error: "privacy_reply_withdraw_failed",
            message:
              "The reply could not be withdrawn from Google. The request stays open and is retried automatically.",
            pending: removal.pending,
            request: settled.request,
          },
          { status: 409 }
        )
      }
      return { request: settled.request }
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
      if (
        (input.status === "completed" || input.status === "rejected") &&
        current.pendingReviewIds.length > 0
      ) {
        // An erasure already scrubbed here with replies still live on Google.
        // Closing it by status would stop the job tick's retry (it claims only
        // `in_progress` rows) and record a finished or refused erasure while
        // the reply stays published. Fulfilling again is the way out.
        throw new ApiError(
          409,
          "privacy_withdrawal_pending",
          "This erasure still has replies to withdraw from Google. Fulfil it again, or wait for the automatic retry."
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
