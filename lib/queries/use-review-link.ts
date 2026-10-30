"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { fetchBusinessInformation } from "@/lib/api/location-business-information"
import {
  createReviewLink,
  fetchReviewLink,
  fetchReviewLinkStats,
  updateReviewLink,
} from "@/lib/api/review-links"
import type { ReviewLinkPeriod } from "@/lib/domain/review-link"
import type {
  ReviewLinkAction,
  ReviewLinkState,
} from "@/lib/domain/review-link-contract"
import { queryKeys } from "./keys"

/**
 * The review link area's data: the link's state (DB-only), its stats, and
 * the writes. Every write answers with the whole state, which replaces the
 * cached one.
 */

export function useReviewLink(locationId: string) {
  return useQuery({
    queryKey: queryKeys.reviewLink(locationId),
    queryFn: ({ signal }) => fetchReviewLink(locationId, { signal }),
  })
}

export function useReviewLinkStats(locationId: string, days: ReviewLinkPeriod) {
  return useQuery({
    queryKey: queryKeys.reviewLinkStats(locationId, days),
    queryFn: ({ signal }) => fetchReviewLinkStats(locationId, days, { signal }),
    // Switching period keeps the last figures on screen until the new ones land.
    placeholderData: keepPreviousData,
  })
}

/**
 * The listing summary carries the link's status (the overview's area card),
 * so a write refreshes it as well as replacing the link's own state.
 */
function useApplyReviewLinkState(locationId: string) {
  const client = useQueryClient()
  return (state: ReviewLinkState) => {
    client.setQueryData(queryKeys.reviewLink(locationId), state)
    void client.invalidateQueries({
      queryKey: queryKeys.listingSummary(locationId),
    })
    void client.invalidateQueries({ queryKey: queryKeys.listingSummaries })
  }
}

export function useCreateReviewLink(locationId: string) {
  const apply = useApplyReviewLinkState(locationId)
  return useMutation({
    mutationFn: (input: { caption?: string | null }) =>
      createReviewLink(locationId, input),
    onSuccess: apply,
  })
}

export function useUpdateReviewLink(locationId: string) {
  const apply = useApplyReviewLinkState(locationId)
  return useMutation({
    mutationFn: (action: ReviewLinkAction) =>
      updateReviewLink(locationId, action),
    onSuccess: apply,
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
      const key = queryKeys.reviewLink(locationId)
      await client.refetchQueries({ queryKey: key, exact: true })
      return (
        client.getQueryData<ReviewLinkState>(key) ??
        (await fetchReviewLink(locationId))
      )
    },
  })
}
