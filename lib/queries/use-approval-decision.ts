"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { decideApproval } from "@/lib/api/approval"
import { refreshStaleReview, useApplyReviewWrite } from "./invalidate"
import { replyMutationKey } from "./use-reply-pending"

/**
 * An approval names what the approver read — the draft on screen and the
 * review's update time — so the server answers 409 `approval_draft_changed` /
 * `review_changed` instead of recording approval of text they never saw, as
 * bulk approve already does. A rejection stays unbound: it must remain
 * possible whatever the pane shows (lib/server/review-approval.ts).
 */
export type ApprovalDecisionInput =
  | {
      decision: "approve"
      draftId: string
      expectedReviewUpdateTime: string
    }
  | { decision: "reject"; note?: string }

export function useApprovalDecision(reviewId: string) {
  const apply = useApplyReviewWrite(reviewId)
  const client = useQueryClient()
  return useMutation({
    // Lets the pane's status line see this is in flight; see use-reply-pending.ts.
    mutationKey: replyMutationKey(reviewId, "approval"),
    mutationFn: (input: ApprovalDecisionInput) =>
      decideApproval(reviewId, input),
    onSuccess: apply,
    // `approval_draft_changed` / `review_changed`: show the current text.
    onError: () => refreshStaleReview(client, reviewId),
  })
}
