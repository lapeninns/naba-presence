/**
 * Shared vocabulary for the reply publish pipeline
 * (docs/architecture.md, "Three-phase reply mutation and recovery").
 *
 * The pipeline is: persist a `started` mutation intent -> call Google outside
 * the database transaction -> settle the local reply and append an attempt
 * event. `recoverAttempt` reads the provider state first and settles
 * `succeeded`, `not_applied`, or `diverged`.
 */

import type { AuthorisationAssurance } from "@/lib/server/mfa"
import type { Session } from "@/lib/server/session"

/** `publish_attempt.authorised_*` (0106): see attemptAuthorisation. */
export type AttemptAuthorisation = {
  userId: string
  assurance: AuthorisationAssurance
  connectionId: string | null
}

/**
 * `publish_attempt.status` CHECK constraint vocabulary (0001_initial.sql,
 * widened by 0035_reply_state_machine.sql). `superseded` is not a provider
 * verdict: it retires an attempt whose mutation the reply has moved past, and
 * unlike `failed` it leaves the row re-armable under its own key.
 */
export type PublishAttemptStatus =
  | "started"
  | "accepted"
  | "succeeded"
  | "retryable"
  | "failed"
  | "ambiguous"
  | "superseded"

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
  /**
   * Set on a `failed` outcome the attempt row parked for an automatic retry
   * (a 429 or a connection-blocked call): when the runner will try again.
   * Absent means nothing will resend this reply on its own.
   */
  retryScheduledAt?: string
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
  /**
   * Who deletes, as the permission checks see them (GrantScope): the live
   * Session in a route, or the scope a background worker re-derived from
   * membership at dispatch (lib/server/authz/actor.ts), as the privacy
   * withdrawal tick does. Either way prepareDelete re-checks location
   * visibility and publish permission against it. The attempt records the
   * session's assurance (0106); a worker's scope carries none, so its
   * attempt records aal1 with no security version.
   */
  session: Pick<
    Session,
    | "role"
    | "userId"
    | "canPublish"
    | "aal"
    | "mfaVerifiedAt"
    | "securityVersion"
  >
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
