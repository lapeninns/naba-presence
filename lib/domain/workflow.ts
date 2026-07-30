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

export function deleteWorkflowTarget(
  branch: "remote" | "local_cancel"
): "new" | "drafted" {
  return branch === "remote" ? "new" : "drafted"
}
