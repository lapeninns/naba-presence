"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  fetchListingCompleteness,
  skipCompletenessCheck,
  unskipCompletenessCheck,
} from "@/lib/api/location-summary"
import type { CompletenessSkipInput } from "@/lib/listings/completeness-contract"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

/** Every visible listing's completeness, for the board. DB-only. */
export function useBoardCompleteness() {
  return useQuery({
    queryKey: queryKeys.listingCompletenessBoard,
    queryFn: (ctx) => fetchListingCompleteness(undefined, requestOptions(ctx)),
    staleTime: 30_000,
  })
}

/** One listing's completeness, for its overview. DB-only. */
export function useListingCompleteness(locationId: string) {
  return useQuery({
    queryKey: queryKeys.listingCompleteness(locationId),
    queryFn: (ctx) =>
      fetchListingCompleteness(locationId, requestOptions(ctx)).then(
        (list) => list[0] ?? null
      ),
    staleTime: 30_000,
  })
}

/** Skip or count again; refreshes every completeness view on success. */
export function useCompletenessSkipMutations(locationId: string) {
  const client = useQueryClient()
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({
        queryKey: queryKeys.listingCompleteness(locationId),
      }),
      client.invalidateQueries({
        queryKey: queryKeys.listingCompletenessBoard,
      }),
    ])
  const skip = useMutation({
    mutationFn: (input: CompletenessSkipInput) =>
      skipCompletenessCheck(locationId, input),
    onSuccess: refresh,
  })
  const unskip = useMutation({
    mutationFn: (checkId: string) =>
      unskipCompletenessCheck(locationId, checkId),
    onSuccess: refresh,
  })
  return { skip, unskip }
}
