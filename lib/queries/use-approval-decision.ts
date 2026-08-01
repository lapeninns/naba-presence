"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { decideApproval } from "@/lib/api/approval"
import { queryKeys } from "./keys"

export function useApprovalDecision(reviewId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { decision: "approve" | "reject"; note?: string }) =>
      decideApproval(reviewId, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.reviewDetail(reviewId) })
      void client.invalidateQueries({ queryKey: ["reviews"] })
      void client.invalidateQueries({ queryKey: ["review-counts"] })
    },
  })
}
