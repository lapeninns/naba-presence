import "server-only"

/**
 * The settle phase's local-state primitives: how a confirmed provider
 * result is applied to `review_reply` and the review workflow. Each
 * orchestrator (publish, delete, retry, recover) composes these inside its
 * own settle transaction next to the attempt-row write and the attempt
 * event (see ./attempt.ts).
 */

import type { TransactionSql } from "postgres"

import { parseReplyModeration } from "@/lib/domain/reply-state"
import type { ReviewWorkflowState } from "@/lib/domain/workflow"

import type { GoogleReviewReply } from "./provider"

/**
 * The lock order for a review's reply state, shared with review sync
 * (`upsertGoogleReview`, lib/server/reviews.ts): the `review` row first, then
 * its `review_reply`, then `publish_attempt` rows. Sync locks the review and
 * then upserts the reply. A settle that wrote the reply and the attempt first
 * and the review workflow last held the other half of that pair, and one of
 * the two transactions died with a deadlock (40P01).
 *
 * So every transaction that writes a reply, an attempt or the workflow of a
 * review calls this before its first write. `for no key update` is the lock
 * the workflow update takes anyway, so this only takes it earlier. It
 * conflicts with sync's `for update` and still lets inserts that reference
 * the review (drafts, approval decisions) check their foreign key.
 */
export async function lockReview(sql: TransactionSql, reviewId: string) {
  await sql`
    select 1 from review where id = ${reviewId} for no key update
  `
}

/** `lockReview` for a transaction that starts from an attempt id. */
export async function lockReviewForAttempt(
  sql: TransactionSql,
  attemptId: string
) {
  await sql`
    select 1
    from review r
    join review_reply rr on rr.review_id = r.id
    join publish_attempt pa on pa.review_reply_id = rr.id
    where pa.id = ${attemptId}
    for no key update of r
  `
}

export type PublishedReply = {
  /** Google moderation state, `PENDING` when Google returned none. */
  googleState: string
  publishStatus: "published" | "rejected"
}

/**
 * Apply Google's accepted reply (body, moderation state, policy violation,
 * update time) to the local reply. A `REJECTED` moderation verdict settles
 * the reply as `rejected`; anything else is `published`. The body is the one
 * Google holds, so a reply blanked or reverted while the PUT was in flight
 * is restored here rather than at the next sync.
 */
export async function applyPublishedReply(
  sql: TransactionSql,
  reviewReplyId: string,
  provider: GoogleReviewReply
): Promise<PublishedReply> {
  const moderation = parseReplyModeration({
    reviewReply: provider,
    reviewReplyState: provider.state,
  })
  const googleState = moderation.state ?? "PENDING"
  const publishStatus = googleState === "REJECTED" ? "rejected" : "published"
  await sql`
    update review_reply
    set
      current_body = coalesce(${moderation.comment}, current_body),
      google_reply_state = ${googleState},
      google_policy_violation = ${moderation.policyViolation},
      google_reply_updated_at = ${moderation.updateTime ?? new Date()},
      publish_status = ${publishStatus},
      first_published_at = case
        when ${publishStatus} = 'published'
          then coalesce(first_published_at, now())
        else first_published_at
      end
    where id = ${reviewReplyId}
  `
  return { googleState, publishStatus }
}

/** Apply a confirmed provider delete: clear the reply and bump its generation. */
export async function applyDeletedReply(
  sql: TransactionSql,
  reviewReplyId: string
) {
  await sql`
    update review_reply
    set
      current_body = null,
      google_reply_state = null,
      google_policy_violation = null,
      publish_status = 'deleted',
      publish_generation = publish_generation + 1,
      google_reply_updated_at = now()
    where id = ${reviewReplyId}
  `
}

/** A deterministic provider rejection fails the reply and the review workflow. */
export async function applyFailedReply(
  sql: TransactionSql,
  input: { reviewReplyId: string; reviewId: string }
) {
  await sql`
    update review_reply
    set publish_status = 'failed'
    where id = ${input.reviewReplyId}
  `
  await setReviewWorkflow(sql, input.reviewId, "failed")
}

export async function setReviewWorkflow(
  sql: TransactionSql,
  reviewId: string,
  status: ReviewWorkflowState
) {
  await sql`
    update review
    set workflow_status = ${status}
    where id = ${reviewId}
  `
}
