"use client"

import {
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query"

import type {
  ReviewRow,
  ReviewsPage,
  ReviewWriteSnapshot,
} from "@/lib/contracts/reviews"
import { restartSettlingClock } from "@/lib/inbox/settling"
import { queryKeys } from "./keys"

/**
 * The review cache map: THE ONE place that decides what a review write
 * refreshes, so hooks, dialogs and bulk code cannot drift on it.
 *
 *   1. Patch what the response describes. A single write answers with the
 *      review's list row and detail (`ReviewWriteSnapshot`), which replace
 *      the cached detail and the row in every loaded list page in place.
 *   2. Await only what the next frame shows: the detail, and only when the
 *      response did not carry it.
 *   3. Everything else in the background. Counts and the clients' needs-reply
 *      badges refetch without being awaited; the lists are only marked stale
 *      (`refetchType: "none"`), so a write no longer re-reads every loaded
 *      page in sequence. Membership — a published row leaving "Needs reply" —
 *      is reconciled on the next mount, focus or settling poll; until then the
 *      row stays where it was with its new status, which is what the
 *      advance-after-publish listener in inbox-view.tsx expects.
 */

/** Replace `row` by id in every loaded page, keeping its position. */
function patchRow(
  data: InfiniteData<ReviewsPage> | undefined,
  row: ReviewRow
): InfiniteData<ReviewsPage> | undefined {
  if (!data?.pages) return data
  let changed = false
  const pages = data.pages.map((page) => {
    const index = page.items.findIndex((item) => item.id === row.id)
    if (index < 0) return page
    changed = true
    const items = page.items.slice()
    items[index] = row
    return { ...page, items }
  })
  return changed ? { ...data, pages } : data
}

function refreshAroundReviews(client: QueryClient) {
  void client.invalidateQueries({ queryKey: queryKeys.reviewCountsAll })
  // The clients list carries each client's needs-reply count.
  void client.invalidateQueries({ queryKey: queryKeys.clientsAll })
}

/**
 * One review was written (draft, verify, approve/reject, publish, delete
 * reply). Resolves once the detail on screen is current.
 */
export async function applyReviewWrite(
  client: QueryClient,
  reviewId: string,
  snapshot: ReviewWriteSnapshot = {}
): Promise<void> {
  // A write can start a publish settling: poll it from a fresh clock.
  restartSettlingClock()
  const { row, detail } = snapshot
  if (row) {
    client.setQueriesData<InfiniteData<ReviewsPage>>(
      { queryKey: queryKeys.reviewsAll },
      (data) => patchRow(data, row)
    )
  }
  void client.invalidateQueries({
    queryKey: queryKeys.reviewsAll,
    refetchType: "none",
  })
  refreshAroundReviews(client)
  if (detail) {
    client.setQueryData(queryKeys.reviewDetail(reviewId), detail)
    return
  }
  await client.invalidateQueries({ queryKey: queryKeys.reviewDetail(reviewId) })
}

/**
 * A write refused because the review or draft moved on (a 409): the pane is
 * stale, so re-read it in the background.
 */
export function refreshStaleReview(client: QueryClient, reviewId: string) {
  void client.invalidateQueries({ queryKey: queryKeys.reviewDetail(reviewId) })
}

/**
 * Many reviews changed at once (a bulk action, a template batch, a sync):
 * there is no row to patch, so the active lists refetch — in the background —
 * along with counts, client badges and any cached detail among `reviewIds`.
 */
export function invalidateReviewBatch(
  client: QueryClient,
  reviewIds: readonly string[] = []
) {
  restartSettlingClock()
  void client.invalidateQueries({ queryKey: queryKeys.reviewsAll })
  refreshAroundReviews(client)
  for (const id of reviewIds) {
    void client.invalidateQueries({ queryKey: queryKeys.reviewDetail(id) })
  }
}

/** `applyReviewWrite` bound to one review, for a mutation's `onSuccess`. */
export function useApplyReviewWrite(reviewId: string) {
  const client = useQueryClient()
  return (snapshot?: ReviewWriteSnapshot) =>
    applyReviewWrite(client, reviewId, snapshot)
}
