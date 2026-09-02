import "server-only"

/**
 * Reply publishing: the barrel for lib/server/publishing/*.
 *
 * docs/architecture.md, "Three-phase reply mutation and recovery":
 *
 *   intent    ./publishing/intent.ts    gates, approval routing, idempotency
 *                                       key, durable `started` attempt
 *   approval  ./publishing/approval.ts  the `awaiting_approval` branch
 *   provider  ./publishing/provider.ts  Google reply PUT / DELETE / GET,
 *                                       always outside a transaction
 *   settle    ./publishing/settle.ts    local reply + workflow settlement
 *   attempt   ./publishing/attempt.ts   `publish_attempt` row + event store,
 *                                       provider-failure classification
 *   publish   ./publishing/publish.ts   executePublish orchestration
 *   delete    ./publishing/delete.ts    executeReplyDelete orchestration
 *   retry     ./publishing/retry.ts     the job runner's due-retry path
 *   recover   ./publishing/recover.ts   readback + intended-body comparison
 *                                       -> succeeded / not_applied / diverged
 *
 * Boundary with lib/server/gbp-write.ts (`runGbpWrite`): the reply pipeline
 * shares the helper's discipline (durable intent -> provider call outside
 * the txn -> settle -> audit) and its error classification primitive
 * (`isAmbiguousProviderError`), but does NOT run through `runGbpWrite`.
 * `publish_attempt` schedules automatic retries (`retryable` +
 * `next_attempt_at` + `attempt_no`, 429 -> back-off) that the helper's
 * settle vocabulary (succeeded/failed/ambiguous) cannot express; an
 * in-flight or ambiguous row is recovered by readback and body comparison
 * rather than rejected with a 409; a permanent `failed` row is a 409 rather
 * than a re-arm; the intent transaction also writes `review_reply`,
 * `review.workflow_status` and `publish_attempt_event`; and a provider
 * failure is returned as an outcome (the routes map it to 409/429) rather
 * than thrown. The job-runner retry and the recovery readback have no
 * idempotency lookup at all. Forcing those through the helper would need
 * the store to smuggle the provider error into `settle` and `find` to
 * throw control-flow signals, so the pipeline keeps its own attempt store.
 */

export {
  classifyProviderFailure,
  findAttemptByKey,
  insertAttempt,
  markAttemptSucceeded,
  rearmAttempt,
  recordAttemptFailure,
  writePublishAttemptEvent,
  type ExistingAttempt,
  type ProviderFailure,
} from "@/lib/server/publishing/attempt"
export { executeReplyDelete } from "@/lib/server/publishing/delete"
export { executePublish } from "@/lib/server/publishing/publish"
export {
  googleReplyFromReview,
  googleReplyMatches,
  parseGoogleReply,
  parseGoogleReview,
  type GoogleReviewReply,
  type GoogleReviewResource,
} from "@/lib/server/publishing/provider"
export {
  decideRecovery,
  recoverAttempt,
  recoverForRequest,
} from "@/lib/server/publishing/recover"
export { retryPublishAttempt } from "@/lib/server/publishing/retry"
export type {
  PublishAttemptEventType,
  PublishAttemptOperation,
  PublishAttemptStatus,
  PublishInput,
  PublishOutcome,
  RecoveryResult,
  ReplyDeleteInput,
  ReplyDeleteOutcome,
  ReplyPublishStatus,
  RetryResult,
} from "@/lib/server/publishing/types"
