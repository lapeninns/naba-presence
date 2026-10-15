import type { OutcomeToastOptions } from "@/components/ui/toast"
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
      reason:
        "This reply cannot be submitted for approval from its current status.",
    }
  }
  return { enabled: true }
}

export function evaluateApproval(input: {
  status: string
  canPublish: boolean
  /**
   * Who the parked reply waits on. `"others"` is the server saying this
   * person may not decide it (under two-person approval, the person who
   * asked), so Approve is not theirs to press.
   */
  approvalScope?: "me" | "others" | "unknown"
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
  if (input.approvalScope === "others") {
    return {
      enabled: false,
      reason: "Someone else with publishing rights needs to approve this reply.",
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

export type OutcomeToastContext = {
  /**
   * Where the review can be seen on Google (`review.googleReplyUrl`). The
   * toast primitive draws it as "View on Google" only when it is a safe
   * https link (components/ui/toast.tsx `isSafeToastHref`).
   */
  googleReplyUrl?: string | null
  /**
   * Google's moderation state for the reply that was just sent
   * (`googleReplyState` on the publish and approval answers). `"PENDING"`
   * means Google has not approved it yet, so the toast must not say it is live.
   */
  googleReplyState?: string | null
  /**
   * The organisation's two-person rule: a submitted reply then goes live
   * only once a different person approves it.
   */
  requireTwoPersonApproval?: boolean
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
//
// The copy states the outcome, not the step (D5): what is now true, in a
// short title and one plain line. None of these offers Undo: publish,
// approve and delete are Google writes, and a reject is undone by submitting
// again, not from a toast.
//
// Each outcome carries the toast primitive's kind, so the type system and
// the Toaster enforce D5 rather than the copy alone: "google" for what
// reached (or is on its way to) Google, which can never offer Undo, and
// "local" for workflow-only outcomes (sent back, an unpublished draft
// removed).
export function describeOutcomeToast(
  status: string,
  context: OutcomeToastContext = {}
): OutcomeToastOptions {
  switch (status) {
    case "published": {
      const url = context.googleReplyUrl
      if (context.googleReplyState === "PENDING") {
        return {
          kind: "google",
          title: "Reply sent",
          description:
            "Google is checking it. It is not public until Google approves it.",
          type: "info",
          ...(url ? { link: { href: url } } : {}),
        }
      }
      return {
        kind: "google",
        title: "Reply published",
        description: "Live on Google.",
        type: "success",
        ...(url ? { link: { href: url } } : {}),
      }
    }
    case "awaiting_approval":
      return {
        kind: "google",
        title: "Submitted for approval",
        description: context.requireTwoPersonApproval
          ? "It goes live once another person with publishing rights approves it."
          : "It goes live once someone with publishing rights approves it.",
        type: "info",
      }
    case "rejected":
      return {
        kind: "google",
        title: "Google declined this reply",
        description: "Edit the reply, then publish it again.",
        type: "error",
      }
    case "returned_to_draft":
      return {
        kind: "local",
        title: "Reply sent back for edits",
        description: "Its author can revise it and submit it again.",
        type: "success",
      }
    case "deleted":
      return {
        kind: "google",
        title: "Reply deleted",
        description: "Removed from Google.",
        type: "success",
      }
    case "cancelled":
      return {
        kind: "local",
        title: "Draft reply removed",
        description: "Nothing was live on Google.",
        type: "success",
      }
    default:
      // e.g. "pending" — an honest, non-committal message; never claims
      // the reply is published.
      return {
        kind: "google",
        title: "Reply submitted",
        description: "Its status will update shortly.",
        type: "info",
      }
  }
}
