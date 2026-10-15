"use client"

import { useIsMutating, useMutationState } from "@tanstack/react-query"

/**
 * Which reply mutation for a given review is in flight right now.
 *
 * The status line and the primary action live in different components — the
 * pane draws the status, the footer owns the mutation — and requirement 5 says
 * they must agree while publishing, not only before and after. Rather than
 * lifting the mutations or threading a callback through three levels, each
 * mutation carries a `mutationKey` and anything that needs to know asks the
 * query client, which is already the shared source of truth.
 */
export type ReplyMutationKind =
  "publish" | "approval" | "rejection" | "draft" | "delete"

/** What a pending approval-decision mutation is deciding, from its input. */
export function decisionPending(variables: unknown): "approval" | "rejection" {
  return (variables as { decision?: string } | undefined)?.decision === "reject"
    ? "rejection"
    : "approval"
}

export function replyMutationKey(reviewId: string, kind: ReplyMutationKind) {
  return ["review-action", reviewId, kind] as const
}

export function useReplyPending(reviewId: string): ReplyMutationKind | null {
  const publish = useIsMutating({
    mutationKey: replyMutationKey(reviewId, "publish"),
  })
  const approval = useIsMutating({
    mutationKey: replyMutationKey(reviewId, "approval"),
  })
  // Approve and Reject share one mutation (and its key); the input says which
  // is running, so the status line does not call a rejection an approval.
  const decisions = useMutationState({
    filters: {
      mutationKey: replyMutationKey(reviewId, "approval"),
      status: "pending",
    },
    select: (mutation) => decisionPending(mutation.state.variables),
  })
  const draft = useIsMutating({
    mutationKey: replyMutationKey(reviewId, "draft"),
  })
  const remove = useIsMutating({
    mutationKey: replyMutationKey(reviewId, "delete"),
  })
  if (publish > 0) return "publish"
  if (approval > 0) {
    return decisions.includes("rejection") ? "rejection" : "approval"
  }
  if (draft > 0) return "draft"
  if (remove > 0) return "delete"
  return null
}
