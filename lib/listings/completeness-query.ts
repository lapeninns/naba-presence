"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch, type RequestOptions } from "@/lib/api/client"
import type { ListingCompleteness } from "@/lib/listings/completeness"
import {
  completenessSkipCreatedResponseSchema,
  completenessSkipRemovedResponseSchema,
  listingCompletenessResponseSchema,
  type CompletenessSkipInput,
} from "@/lib/listings/completeness-contract"
import { requestOptions } from "@/lib/queries/request-options"

/**
 * Rooted under "listing-summary" so every invalidation of the listing
 * summaries (after a publish, an edit, a sync) refreshes completeness too.
 */
export const completenessQueryKeys = {
  all: ["listing-summary", "completeness"] as const,
  board: ["listing-summary", "completeness", "all"] as const,
  listing: (id: string) => ["listing-summary", "completeness", id] as const,
}

// INTEGRATION(S1): these fetchers can move to lib/api/location-summary.ts and
// the keys to lib/queries/keys.ts when the stream is merged.
export function fetchListingCompleteness(
  locationId?: string,
  options?: RequestOptions
): Promise<ListingCompleteness[]> {
  const query = new URLSearchParams({ view: "completeness" })
  if (locationId) query.set("locationId", locationId)
  return apiFetch(`/api/listings/summary?${query}`, {
    schema: listingCompletenessResponseSchema,
    ...options,
  }).then((response) => response.completeness)
}

/** Every visible listing's completeness, for the board. DB-only. */
export function useBoardCompleteness() {
  return useQuery({
    queryKey: completenessQueryKeys.board,
    queryFn: (ctx) => fetchListingCompleteness(undefined, requestOptions(ctx)),
    staleTime: 30_000,
  })
}

/** One listing's completeness, for its overview. DB-only. */
export function useListingCompleteness(locationId: string) {
  return useQuery({
    queryKey: completenessQueryKeys.listing(locationId),
    queryFn: (ctx) =>
      fetchListingCompleteness(locationId, requestOptions(ctx)).then(
        (list) => list[0] ?? null
      ),
    staleTime: 30_000,
  })
}

export function skipCompletenessCheck(
  locationId: string,
  input: CompletenessSkipInput
) {
  return apiFetch(`/api/locations/${locationId}/completeness-skips`, {
    method: "POST",
    body: input,
    schema: completenessSkipCreatedResponseSchema,
  })
}

export function unskipCompletenessCheck(locationId: string, checkId: string) {
  const query = new URLSearchParams({ checkId })
  return apiFetch(`/api/locations/${locationId}/completeness-skips?${query}`, {
    method: "DELETE",
    schema: completenessSkipRemovedResponseSchema,
  })
}

/** Skip or count again; refreshes every completeness view on success. */
export function useCompletenessSkipMutations(locationId: string) {
  const client = useQueryClient()
  const refresh = () =>
    client.invalidateQueries({ queryKey: completenessQueryKeys.all })
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
