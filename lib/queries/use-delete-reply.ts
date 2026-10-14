"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { deletePublishedReply } from "@/lib/api/reply"
import { refreshStaleReview, useApplyReviewWrite } from "./invalidate"
import { replyMutationKey } from "./use-reply-pending"

export function useDeleteReply(reviewId: string) {
  const apply = useApplyReviewWrite(reviewId)
  const client = useQueryClient()
  return useMutation({
    // Lets the pane's status line see this is in flight; see use-reply-pending.ts.
    mutationKey: replyMutationKey(reviewId, "delete"),
    mutationFn: () => deletePublishedReply(reviewId),
    onSuccess: apply,
    onError: () => refreshStaleReview(client, reviewId),
  })
}
