export const REVIEW_WORKFLOW_STATES = [
  "new",
  "drafted",
  "verified",
  "awaiting_approval",
  "publish_requested",
  "published",
  "rejected",
  "failed",
  "escalated",
] as const

export type ReviewWorkflowState = (typeof REVIEW_WORKFLOW_STATES)[number]

const ALLOWED_TRANSITIONS: Record<
  ReviewWorkflowState,
  readonly ReviewWorkflowState[]
> = {
  new: ["drafted", "escalated", "published"],
  drafted: ["verified", "drafted", "escalated"],
  verified: ["drafted", "awaiting_approval", "publish_requested", "escalated"],
  awaiting_approval: ["drafted", "publish_requested", "escalated"],
  publish_requested: ["published", "rejected", "failed"],
  published: ["drafted", "new", "rejected"],
  rejected: ["drafted", "publish_requested", "new"],
  failed: ["drafted", "publish_requested", "new"],
  escalated: ["drafted", "awaiting_approval", "publish_requested"],
}

export function isAllowedReviewTransition(
  from: ReviewWorkflowState,
  to: ReviewWorkflowState
) {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to)
}

/**
 * Where a reply delete leaves the review. `remote` (Google confirmed the
 * reply is gone) always returns it to `new`.
 *
 * A local cancel withdraws a reply that never reached Google and normally
 * returns the review to `drafted` — but there is no path from
 * `publish_requested` back to `drafted`, here or in
 * `enforce_review_workflow_transition` (0006_reply_lifecycle.sql). Widening
 * that rule would make the drafts route's own `publish_requested` gate a
 * permanent no-op, so the target moves instead: a withdrawn publish intent
 * settles `failed`, which is both re-draftable and re-publishable. Callers
 * that pass no `from` keep the `drafted` answer.
 */
export function deleteWorkflowTarget(
  branch: "remote" | "local_cancel",
  from?: ReviewWorkflowState
): ReviewWorkflowState {
  if (branch === "remote") return "new"
  return from === "publish_requested" ? "failed" : "drafted"
}
