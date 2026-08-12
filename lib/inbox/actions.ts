import {
  isAllowedReviewTransition,
  REVIEW_WORKFLOW_STATES,
  type ReviewWorkflowState,
} from "@/lib/domain/workflow"

export type ActionAvailability = { enabled: boolean; reason?: string }

function asState(status: string): ReviewWorkflowState | null {
  return (REVIEW_WORKFLOW_STATES as readonly string[]).includes(status)
    ? (status as ReviewWorkflowState)
    : null
}

export function evaluatePublish(input: {
  status: string
  canPublish: boolean
  hasVerifiedDraft: boolean
  isDirty: boolean
}): ActionAvailability {
  if (!input.canPublish) {
    return {
      enabled: false,
      reason: "You do not have permission to publish for this location.",
    }
  }
  // Draft-first ordering. Every condition below must pass either way, so this
  // does not change WHETHER the action is available — only which reason gets
  // reported. A brand-new review fails the transition guard AND has no draft;
  // "save and verify a draft" is the one an operator can act on, and since
  // the reason is now rendered on the page rather than hidden in a `title`, an
  // unhelpful one is a visible dead end.
  if (!input.hasVerifiedDraft) {
    return {
      enabled: false,
      reason: "Save and verify a draft before publishing.",
    }
  }
  // Ahead of the transition guard for the same reason: an edited reply on an
  // already-published review fails BOTH checks, and saving is what moves it to
  // `drafted` and opens the path. "Cannot be published from its current
  // status" would be a true statement and a dead end.
  if (input.isDirty) {
    return { enabled: false, reason: "Save your draft before publishing." }
  }
  const state = asState(input.status)
  if (!state || !isAllowedReviewTransition(state, "publish_requested")) {
    return {
      enabled: false,
      reason: "This reply cannot be published from its current status.",
    }
  }
  return { enabled: true }
}

// D2: mirrors evaluatePublish, including its transition guard, because the
// affordance this gates reuses the SAME publish mutation (the server routes
// a non-publisher's publish to `awaiting_approval` when the org requires
// approval — see lib/server/publishing.ts's `!canPublish && approval_required`
// branch). Without the identical `isAllowedReviewTransition(state,
// "publish_requested")` check, this could enable a button for a status the
// reused mutation would reject with a 409.
export function evaluateRequestApproval(input: {
  status: string
  canRequestApproval: boolean
  hasVerifiedDraft: boolean
  isDirty: boolean
}): ActionAvailability {
  if (!input.canRequestApproval) return { enabled: false }
  // Draft-first, for the same reason as evaluatePublish above: the reason is
  // shown to the operator, so the actionable one wins when several apply.
  if (!input.hasVerifiedDraft) {
    return {
      enabled: false,
      reason: "Verify a draft before submitting it for approval.",
    }
  }
  if (input.isDirty) {
    return {
      enabled: false,
      reason: "Save your draft before submitting it for approval.",
    }
  }
  const state = asState(input.status)
  if (!state || !isAllowedReviewTransition(state, "publish_requested")) {
    return {
      enabled: false,
      reason: "This reply cannot be submitted for approval from its current status.",
    }
  }
  return { enabled: true }
}

export function evaluateApproval(input: {
  status: string
  canPublish: boolean
}): ActionAvailability {
  if (input.status !== "awaiting_approval") {
    return { enabled: false, reason: "This reply is not awaiting approval." }
  }
  if (!input.canPublish) {
    return {
      enabled: false,
      reason: "You do not have permission to approve for this location.",
    }
  }
  return { enabled: true }
}

export function evaluateDelete(input: {
  hasPublishedReply: boolean
  canPublish: boolean
}): ActionAvailability {
  if (!input.hasPublishedReply) {
    return { enabled: false, reason: "There is no published reply to delete." }
  }
  if (!input.canPublish) {
    return {
      enabled: false,
      reason: "You do not have permission to change this reply.",
    }
  }
  return { enabled: true }
}

export type OutcomeToast = {
  title: string
  description?: string
  type: "success" | "info" | "warning" | "error"
}

// Maps a SERVER-CONFIRMED resolved status (never a thrown ApiClientError code
// — see describeActionError for those) from a publish or approval-decision
// mutation to user-facing toast copy. Every resolved, non-throwing status
// either route can return is covered here so a `rejected` — or any other
// non-published — outcome never renders as "published" (D7, no optimistic
// publish; fix-round-1 CRITICAL #1). `rejected` always means Google's own
// moderation declined the reply content (see lib/server/publishing.ts); a
// user-initiated Reject decision instead resolves as `returned_to_draft`,
// which is a distinct, unambiguous wire value.
export function describeOutcomeToast(status: string): OutcomeToast {
  switch (status) {
    case "published":
      return {
        title: "Reply published",
        description: "It is live on Google now.",
        type: "success",
      }
    case "awaiting_approval":
      return {
        title: "Submitted for approval",
        description: "A manager needs to approve it before it goes live.",
        type: "info",
      }
    case "rejected":
      return {
        title: "Google declined this reply",
        description: "Edit the draft and try publishing again.",
        type: "error",
      }
    case "returned_to_draft":
      return {
        title: "Reply sent back for edits",
        description: "The author can revise it and submit again.",
        type: "success",
      }
    case "deleted":
      return {
        title: "Reply deleted",
        description: "It is no longer shown on Google.",
        type: "success",
      }
    case "cancelled":
      return {
        title: "Draft reply removed",
        description: "Nothing was live on Google.",
        type: "success",
      }
    default:
      // e.g. "pending" — an honest, non-committal message; never claims
      // the reply is published.
      return {
        title: "Reply submitted",
        description: "Its status will update shortly.",
        type: "info",
      }
  }
}
