import "server-only"

import type { TransactionSql } from "postgres"

import { writeAudit } from "@/lib/server/audit"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import { executeReplyDelete } from "@/lib/server/publishing"
import { supersedeAttempts } from "@/lib/server/publishing/attempt"
import { withTenant } from "@/lib/server/db"
import type { ReplyDeleteInput } from "@/lib/server/publishing/types"

/**
 * Erasure fulfilment, shared by the owner's PATCH
 * (app/api/privacy/requests/route.ts) and the background withdrawal tick
 * (lib/server/privacy/withdrawals.ts, plan P04-5).
 *
 * An erasure has two halves. The local scrub (`eraseReviews`) commits inside
 * the fulfil transaction. Withdrawing the replies still live at Google
 * (`withdrawReplies`) runs outside any transaction, one provider round trip
 * per reply; whatever Google will not drop leaves the request `in_progress`
 * with `pending_review_ids`, and `settleWithdrawal` schedules the next
 * automatic round with backoff until the budget is spent.
 */

/** The two states a request can still be acted on from. */
export const OPEN_STATUSES = ["pending", "in_progress"]

/**
 * `review_reply.publish_status` values that mean nothing is left at Google.
 * Everything else -- including `awaiting_approval` and `accepted`, which
 * `executeReplyDelete` withdraws locally -- goes through the delete pipeline.
 * This is the same predicate `loadDeleteRecord` answers 404 to.
 */
export const WITHDRAWN_REPLY_STATUSES = new Set(["deleted", "not_published"])

/**
 * What `draft.body` becomes on erasure. The column is `not null`, so the
 * reviewer's name is replaced rather than dropped.
 */
export const ERASED_DRAFT_BODY = "[Removed at the data subject's request]"

/**
 * Withdrawal rounds an erasure gets, the inline one in the PATCH included,
 * before the tick stops retrying and the console surfaces it for a human.
 * With PRIVACY_WITHDRAWAL_RETRY_* the rounds span about a day, long enough
 * to ride out a Google outage or a lapsed connection being reconnected.
 */
export const PRIVACY_WITHDRAWAL_MAX_ATTEMPTS = 12
const PRIVACY_WITHDRAWAL_RETRY_BASE_MS = 60_000
const PRIVACY_WITHDRAWAL_RETRY_CAP_MS = 6 * 60 * 60_000

/**
 * How soon a paused provider is looked at again. A pause is an operator's
 * decision, not a failure, so it costs no attempt.
 */
export const PRIVACY_WITHDRAWAL_PAUSE_RECHECK_MS = 5 * 60_000

/**
 * When a freshly parked request first becomes claimable by the tick. The
 * PATCH settles its own inline round long before this; the delay only
 * matters when that process dies mid-withdrawal, so the request is not left
 * without a retry.
 */
export const PRIVACY_WITHDRAWAL_PARK_GRACE = "5 minutes"

/**
 * A reply the round had no time left to try. The round stops before a
 * provider call that could outlive its caller's budget (the job tick's, or
 * the PATCH's `maxDuration`): a process killed mid-round never settles, so
 * it would neither spend its budget nor record what it did.
 */
export const WITHDRAWAL_OUT_OF_TIME = "withdrawal_out_of_time"

/**
 * Codes that mean "not now", never "failed": a pause or a round that ran out
 * of time defers for free.
 */
const DEFERRED_CODES = new Set(["publishing_paused", WITHDRAWAL_OUT_OF_TIME])

/** Delay after `attempts` failed rounds (1-based), doubling to the cap. */
export function withdrawalRetryDelayMs(attempts: number) {
  return Math.min(
    PRIVACY_WITHDRAWAL_RETRY_CAP_MS,
    PRIVACY_WITHDRAWAL_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1)
  )
}

export type ErasureScrub = {
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
export async function scrubAttemptBodies(
  sql: TransactionSql,
  replyIds: string[]
) {
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
export async function eraseReviews(
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

export type WithdrawalPending = { reviewId: string; code: string }

export type WithdrawalResult = {
  withdrawn: string[]
  pending: WithdrawalPending[]
}

/**
 * Withdraw the replies an erasure matched, one provider round trip each.
 *
 * Deliberately outside the erasure transaction -- a provider call never runs
 * inside an open tenant transaction -- and outside its failure boundary: a
 * reply Google refuses to drop must not roll back the local scrub. Each
 * failure is collected instead, and leaves the request open for a retry.
 *
 * `actor` is the live Session in the PATCH, or the scope the background
 * tick re-derived from membership; `executeReplyDelete` re-checks it at
 * every location either way.
 *
 * `deadline` (epoch ms) bounds the round: a reply is only started with one
 * provider timeout's worth of time left, and the rest are returned pending
 * as `withdrawal_out_of_time`. The first live reply is always tried, so a
 * round that starts always makes progress or spends an attempt.
 */
export async function withdrawReplies(input: {
  organisationId: string
  actor: ReplyDeleteInput["session"]
  requestId: string
  reviewIds: string[]
  deadline?: number
}): Promise<WithdrawalResult> {
  const withdrawn: string[] = []
  const pending: WithdrawalPending[] = []
  const env = getServerEnv()
  // Withdrawing a reply is a Google write, and the manual delete route pauses
  // on the same flag. Nothing is lost by honouring it: the local scrub is
  // already committed and the request stays open until publishing resumes.
  if (!env.PUBLISH_ENABLED) {
    return {
      withdrawn,
      pending: input.reviewIds.map((reviewId) => ({
        reviewId,
        code: "publishing_paused",
      })),
    }
  }
  // A reply something else already withdrew -- the job runner settling an
  // ambiguous delete, or an owner deleting it by hand -- is done. Asking the
  // delete pipeline again would answer 404 and park a finished erasure.
  const live = await withTenant(input.organisationId, async (sql) => {
    const rows = await sql<{ reviewId: string }[]>`
      select review_id::text as "reviewId"
      from review_reply
      where review_id = any(${input.reviewIds}::uuid[])
        and publish_status not in ${sql([...WITHDRAWN_REPLY_STATUSES])}
    `
    return new Set(rows.map(({ reviewId }) => reviewId))
  })
  let tried = 0
  for (const reviewId of input.reviewIds) {
    if (!live.has(reviewId)) {
      withdrawn.push(reviewId)
      continue
    }
    if (
      tried > 0 &&
      input.deadline !== undefined &&
      Date.now() + env.GOOGLE_TIMEOUT_MS > input.deadline
    ) {
      pending.push({ reviewId, code: WITHDRAWAL_OUT_OF_TIME })
      continue
    }
    tried += 1
    try {
      const outcome = await executeReplyDelete({
        organisationId: input.organisationId,
        session: input.actor,
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

/** The PATCH response projection, shared by every resolution update. */
export const RESOLUTION_COLUMNS = `
  id::text as id, request_type as "requestType", status,
  subject_reference as "subjectReference",
  resolution_note as "resolutionNote", resolved_at as "resolvedAt",
  withdrawal_attempts as "withdrawalAttempts",
  next_attempt_at as "nextAttemptAt",
  last_error_code as "lastErrorCode"
`

export type WithdrawalSettlement =
  | { outcome: "completed"; request: Record<string, unknown> }
  | {
      outcome: "retry_scheduled" | "deferred" | "exhausted"
      request: Record<string, unknown>
    }
  /** Rejected or completed by someone else while the round ran. */
  | { outcome: "resolved_elsewhere"; request: null }

/**
 * The trail of an erasure whose retry budget is spent: whichever way the last
 * round ended, the audit says why the automatic retries stopped.
 */
export async function recordWithdrawalExhausted(
  sql: TransactionSql,
  input: {
    organisationId: string
    privacyRequestId: string
    actorUserId: string | null
    requestId: string
    attempts: number
    lastErrorCode: string
    pending: WithdrawalPending[] | null
  }
) {
  await writeAudit(sql, {
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: "privacy.request.withdrawal_exhausted",
    subjectType: "privacy_request",
    subjectId: input.privacyRequestId,
    requestId: input.requestId,
    metadata: {
      attempts: input.attempts,
      lastErrorCode: input.lastErrorCode,
      pending: input.pending,
    },
  })
  log.error("privacy.withdrawal_exhausted", {
    organisationId: input.organisationId,
    privacyRequestId: input.privacyRequestId,
    attempts: input.attempts,
    lastErrorCode: input.lastErrorCode,
  })
}

/**
 * Record one withdrawal round and decide what happens next: complete the
 * request, schedule the next round with backoff, defer it (pause), or stop
 * retrying once the budget is spent.
 */
export async function settleWithdrawal(input: {
  organisationId: string
  privacyRequestId: string
  /** The owner the round ran as; `resolved_by` when it completes. */
  actorUserId: string
  requestId: string
  clientRequestId?: string | null
  source: "fulfil" | "background"
  /** Every review the round tried, for the second attempt-body scrub. */
  reviewIds: string[]
  removal: WithdrawalResult
}): Promise<WithdrawalSettlement> {
  const { removal } = input
  return withTenant(input.organisationId, async (sql) => {
    // The withdrawal forced every in-flight attempt through recovery, so
    // the bodies phase one had to leave alone can go now.
    const replies = await sql<{ id: string }[]>`
      select rr.id::text as id
      from review_reply rr
      where rr.review_id = any(${input.reviewIds}::uuid[])
    `
    const attemptBodiesRedacted = replies.length
      ? await scrubAttemptBodies(
          sql,
          replies.map(({ id }) => id)
        )
      : 0
    await writeAudit(sql, {
      organisationId: input.organisationId,
      actorUserId: input.actorUserId,
      action: "privacy.request.replies_withdrawn",
      subjectType: "privacy_request",
      subjectId: input.privacyRequestId,
      requestId: input.requestId,
      metadata: {
        source: input.source,
        withdrawn: removal.withdrawn.length,
        pending: removal.pending,
        attemptBodiesRedacted,
        clientRequestId: input.clientRequestId ?? null,
      },
    })

    const [current] = await sql<{ status: string; attempts: number }[]>`
      select status, withdrawal_attempts as attempts
      from privacy_request
      where id = ${input.privacyRequestId}
      for update
    `
    if (!current || !OPEN_STATUSES.includes(current.status)) {
      return { outcome: "resolved_elsewhere", request: null }
    }

    if (removal.pending.length === 0) {
      const [row] = await sql`
        update privacy_request
        set
          status = 'completed',
          pending_review_ids = '{}',
          resolved_by = ${input.actorUserId},
          resolved_at = now(),
          next_attempt_at = null,
          last_error_code = null,
          withdrawal_lease_expires_at = null
        where id = ${input.privacyRequestId}
        returning ${sql.unsafe(RESOLUTION_COLUMNS)}
      `
      return { outcome: "completed", request: row }
    }

    const pendingIds = removal.pending.map(({ reviewId }) => reviewId)
    // The code that explains the round: a real failure over a deferral.
    const code = (
      removal.pending.find((item) => !DEFERRED_CODES.has(item.code)) ??
      removal.pending[0]!
    ).code
    if (removal.pending.every((item) => DEFERRED_CODES.has(item.code))) {
      // Out of time is picked up by the next tick; a pause is looked at
      // again after a while.
      const recheckMs =
        code === WITHDRAWAL_OUT_OF_TIME
          ? 0
          : PRIVACY_WITHDRAWAL_PAUSE_RECHECK_MS
      const [row] = await sql`
        update privacy_request
        set
          pending_review_ids = ${pendingIds}::uuid[],
          next_attempt_at = ${new Date(Date.now() + recheckMs)},
          last_error_code = ${code},
          withdrawal_lease_expires_at = null
        where id = ${input.privacyRequestId}
        returning ${sql.unsafe(RESOLUTION_COLUMNS)}
      `
      return { outcome: "deferred", request: row }
    }

    const attempts = current.attempts + 1
    const exhausted = attempts >= PRIVACY_WITHDRAWAL_MAX_ATTEMPTS
    const [row] = await sql`
      update privacy_request
      set
        pending_review_ids = ${pendingIds}::uuid[],
        withdrawal_attempts = ${attempts},
        next_attempt_at = ${
          exhausted
            ? null
            : new Date(Date.now() + withdrawalRetryDelayMs(attempts))
        },
        last_error_code = ${code},
        withdrawal_lease_expires_at = null
      where id = ${input.privacyRequestId}
      returning ${sql.unsafe(RESOLUTION_COLUMNS)}
    `
    if (exhausted) {
      await recordWithdrawalExhausted(sql, {
        organisationId: input.organisationId,
        privacyRequestId: input.privacyRequestId,
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        attempts,
        lastErrorCode: code,
        pending: removal.pending,
      })
    }
    return {
      outcome: exhausted ? "exhausted" : "retry_scheduled",
      request: row,
    }
  })
}
