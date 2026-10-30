"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { apiFetch, type RequestOptions } from "@/lib/api/client"
import { fetchBusinessInformation } from "@/lib/api/location-business-information"
import type { ReviewLinkPeriod } from "@/lib/domain/review-link"
import {
  reviewLinkQueryKeys,
  reviewLinkResponseSchema,
  reviewLinkStatsResponseSchema,
  type ReviewLinkAction,
  type ReviewLinkState,
  type ReviewLinkStats,
} from "@/lib/domain/review-link-contract"
import { queryKeys } from "@/lib/queries/keys"

// INTEGRATION(S2): these fetchers and hooks belong in lib/api/review-links.ts
// and lib/queries/use-review-link.ts, outside this stream's files.

/**
 * The review link area's data: the link's state (DB-only), its stats, and
 * the writes. Every write answers with the whole state, which replaces the
 * cached one.
 */

const path = (locationId: string) => `/api/locations/${locationId}/review-link`

export function fetchReviewLink(
  locationId: string,
  options?: RequestOptions
): Promise<ReviewLinkState> {
  return apiFetch(path(locationId), {
    schema: reviewLinkResponseSchema,
    ...options,
  }).then((response) => response.reviewLink)
}

export function useReviewLink(locationId: string) {
  return useQuery({
    queryKey: reviewLinkQueryKeys.state(locationId),
    queryFn: ({ signal }) => fetchReviewLink(locationId, { signal }),
  })
}

export function useReviewLinkStats(locationId: string, days: ReviewLinkPeriod) {
  return useQuery<ReviewLinkStats>({
    queryKey: reviewLinkQueryKeys.stats(locationId, days),
    queryFn: ({ signal }) =>
      apiFetch(`${path(locationId)}/stats?days=${days}`, {
        schema: reviewLinkStatsResponseSchema,
        signal,
      }).then((response) => response.stats),
    // Switching period keeps the last figures on screen until the new ones land.
    placeholderData: keepPreviousData,
  })
}

export function useCreateReviewLink(locationId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { caption?: string | null }) =>
      apiFetch(path(locationId), {
        method: "POST",
        body: input,
        schema: reviewLinkResponseSchema,
      }).then((response) => response.reviewLink),
    onSuccess: (state) =>
      client.setQueryData(reviewLinkQueryKeys.state(locationId), state),
  })
}

export function useUpdateReviewLink(locationId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (action: ReviewLinkAction) =>
      apiFetch(path(locationId), {
        method: "PATCH",
        body: action,
        schema: reviewLinkResponseSchema,
      }).then((response) => response.reviewLink),
    onSuccess: (state) =>
      client.setQueryData(reviewLinkQueryKeys.state(locationId), state),
  })
}

/**
 * Reads the listing's details from Google again (the Business Information
 * read, `?refresh=1`), then the link's state, which takes Google's review
 * form from that read.
 */
export function useCheckGoogleForReviewForm(locationId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const business = await fetchBusinessInformation(locationId, undefined, {
        refresh: true,
      })
      client.setQueryData(
        queryKeys.locationBusinessInformation(locationId),
        business
      )
      // A live read records a new observation, which the listing summary
      // and the client hub show (as useRefreshProfile does).
      void client.invalidateQueries({
        queryKey: queryKeys.listingSummary(locationId),
      })
      void client.invalidateQueries({ queryKey: queryKeys.listingSummaries })
      void client.invalidateQueries({ queryKey: queryKeys.clientsAll })
      // A fetch already in flight may predate the read: cancel it and read again.
      const key = reviewLinkQueryKeys.state(locationId)
      await client.refetchQueries({ queryKey: key, exact: true })
      return (
        client.getQueryData<ReviewLinkState>(key) ??
        (await fetchReviewLink(locationId))
      )
    },
  })
}
