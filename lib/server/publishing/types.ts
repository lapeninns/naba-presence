/**
 * Shared vocabulary for the reply publish pipeline
 * (docs/architecture.md, "Three-phase reply mutation and recovery").
 *
 * The pipeline is: persist a `started` mutation intent -> call Google outside
 * the database transaction -> settle the local reply and append an attempt
 * event. `recoverAttempt` reads the provider state first and settles
 * `succeeded`, `not_applied`, or `diverged`.
 */

import type { Session } from "@/lib/server/session"

/** `publish_attempt.status` CHECK constraint vocabulary (0001_initial.sql). */
export type PublishAttemptStatus =
  "started" | "accepted" | "succeeded" | "retryable" | "failed" | "ambiguous"

/** `publish_attempt.operation`. */
export type PublishAttemptOperation = "publish" | "delete"

/** `publish_attempt_event.event_type` CHECK constraint vocabulary. */
export type PublishAttemptEventType =
  | "started"
  | "provider_accepted"
  | "provider_rejected"
  | "retry_scheduled"
  | "ambiguity_checked"
  | "completed"

/** `review_reply.publish_status` CHECK constraint vocabulary. */
export type ReplyPublishStatus =
  | "not_published"
  | "awaiting_approval"
  | "accepted"
  | "published"
  | "rejected"
  | "failed"
  | "deleted"

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

export type PublishInput = {
  organisationId: string
  session: Session
  reviewId: string
  draftId: string
  expectedReviewUpdateTime: string
  requestId: string
}

export type ReplyDeleteInput = {
  organisationId: string
  session: Session
  reviewId: string
  requestId: string
}

export type ReplyDeleteOutcome = {
  status: "deleted" | "cancelled" | "ambiguous"
  attemptId: string | null
}

export type RecoveryResult = "succeeded" | "not_applied" | "diverged"

export type RetryResult =
  "succeeded" | "retryable" | "ambiguous" | "failed" | "skipped"
