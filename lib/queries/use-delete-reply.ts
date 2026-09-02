"use client"

import { useMutation } from "@tanstack/react-query"

import { deletePublishedReply } from "@/lib/api/reply"
import { useInvalidateReviewWrites } from "./invalidate"

export function useDeleteReply(reviewId: string) {
  const invalidate = useInvalidateReviewWrites(reviewId)
  return useMutation({
    mutationFn: () => deletePublishedReply(reviewId),
    onSuccess: invalidate,
  })
}
