"use client"

import { useMutation } from "@tanstack/react-query"

import { decideApproval } from "@/lib/api/approval"
import { useInvalidateReviewWrites } from "./invalidate"

export function useApprovalDecision(reviewId: string) {
  const invalidate = useInvalidateReviewWrites(reviewId)
  return useMutation({
    mutationFn: (input: { decision: "approve" | "reject"; note?: string }) =>
      decideApproval(reviewId, input),
    onSuccess: invalidate,
  })
}
