"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  decideImportProposal,
  fetchImportReview,
  fetchImportReviewCounts,
  refreshImportReview,
  type DecideProposalInput,
} from "@/lib/api/location-import-review"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useImportReview(id: string, resourceType?: "profile" | "food_menus") {
  return useQuery({
    queryKey: [...queryKeys.locationImportReview(id), resourceType ?? "all"],
    queryFn: (ctx) => fetchImportReview(id, resourceType, requestOptions(ctx)),
  })
}

export function useImportReviewCounts() {
  return useQuery({
    queryKey: queryKeys.importReviewCounts,
    queryFn: (ctx) => fetchImportReviewCounts(requestOptions(ctx)),
    staleTime: 60_000,
  })
}

function useInvalidateImportReview(id: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.locationImportReview(id) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.importReviewCounts })
    // Decisions change canonical data; the owning tab caches must refetch.
    void queryClient.invalidateQueries({ queryKey: queryKeys.locationMenu(id) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.locationProfile(id) })
  }
}

export function useRefreshImportReview(id: string) {
  const invalidate = useInvalidateImportReview(id)
  return useMutation({
    mutationFn: (resourceType: "profile" | "food_menus" | "all" = "all") =>
      refreshImportReview(id, resourceType),
    onSuccess: invalidate,
  })
}

export function useDecideImportProposal(id: string) {
  const invalidate = useInvalidateImportReview(id)
  return useMutation({
    mutationFn: (input: DecideProposalInput & { proposalId: string }) =>
      decideImportProposal(id, input.proposalId, input),
    onSettled: invalidate,
  })
}
