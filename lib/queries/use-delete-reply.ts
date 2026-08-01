"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { deletePublishedReply } from "@/lib/api/reply"
import { queryKeys } from "./keys"

export function useDeleteReply(reviewId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => deletePublishedReply(reviewId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.reviewDetail(reviewId) })
      void client.invalidateQueries({ queryKey: ["reviews"] })
      void client.invalidateQueries({ queryKey: ["review-counts"] })
    },
  })
}
