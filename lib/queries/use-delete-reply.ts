"use client"

import { useMutation } from "@tanstack/react-query"

import { deletePublishedReply } from "@/lib/api/reply"
import { useInvalidateReviewWrites } from "./invalidate"
import { replyMutationKey } from "./use-reply-pending"

export function useDeleteReply(reviewId: string) {
  const invalidate = useInvalidateReviewWrites(reviewId)
  return useMutation({
    // Lets the pane's status line see this is in flight; see use-reply-pending.ts.
    mutationKey: replyMutationKey(reviewId, "delete"),
    mutationFn: () => deletePublishedReply(reviewId),
    onSuccess: invalidate,
  })
}
