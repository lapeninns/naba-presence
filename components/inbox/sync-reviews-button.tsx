"use client"

import { RefreshCwIcon } from "lucide-react"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { useToastManager } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import { fetchReviewCounts, type ReviewCounts } from "@/lib/api/review-counts"
import { triggerReviewSync } from "@/lib/api/sync"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatNumber } from "@/lib/format"
import { invalidateReviewBatch } from "@/lib/queries/invalidate"
import { queryKeys } from "@/lib/queries/keys"

// Every outcome of this control is "the latest sync result": one id, so a
// toast replaces the one before it instead of stacking beside it ("Could not
// sync reviews" and "Up to date" together after a retry).
const SYNC_TOAST_ID = "sync-reviews"

/**
 * Pulls the newest reviews from Google for this organisation.
 *
 * Owners and admins only: the reconcile route refuses everyone else. A lock
 * already held by the scheduled check comes back as `skipped`, which is not
 * a failure.
 */
export function SyncReviewsButton({ canSync }: { canSync: boolean }) {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const [pending, setPending] = useState(false)
  if (!canSync) return null

  // Failures go where success goes: a toast that dismisses itself, rather
  // than a caption under the icon that stayed until the next sync.
  const fail = (description: string) =>
    toasts.add({
      id: SYNC_TOAST_ID,
      title: "Could not sync reviews",
      description,
      type: "error",
    })

  async function run() {
    setPending(true)
    // The organisation's review total as this page last had it. The sync
    // route reports what it wrote, which includes every unchanged review on
    // Google's newest page, so "new" is the difference in the total instead.
    const countsKey = queryKeys.reviewCounts("organisation")
    const before = queryClient.getQueryData<ReviewCounts>(countsKey)?.total
    try {
      const result = await triggerReviewSync()
      if (result.skipped) {
        fail("A sync is already running. Try again in a moment.")
        return
      }
      // In the background: the toast waits only on the counts read below,
      // which joins the counts refetch this starts rather than sending a
      // second request.
      invalidateReviewBatch(queryClient)
      const failure = result.failures?.[0]?.errorCode
      if (failure) {
        fail(describeActionError(new ApiClientError(502, failure, failure)))
        return
      }
      const after = await queryClient
        .fetchQuery({
          queryKey: countsKey,
          queryFn: () => fetchReviewCounts(),
          staleTime: 0,
        })
        .then((counts) => counts.total)
        .catch(() => undefined)
      const added =
        before !== undefined && after !== undefined
          ? Math.max(0, after - before)
          : null
      toasts.add({
        id: SYNC_TOAST_ID,
        ...(added === null
          ? { title: "Reviews synced", type: "success" }
          : added === 0
            ? {
                title: "Up to date",
                description: "Google has no reviews newer than these.",
                type: "success",
              }
            : {
                title: `${formatNumber(added)} new ${added === 1 ? "review" : "reviews"}`,
                description: "They are in the list now.",
                type: "success",
              }),
      })
    } catch (caught) {
      fail(describeActionError(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      variant="ghost"
      onClick={() => void run()}
      pending={pending}
      // The words fold away on a phone, where it is a square 44px icon
      // button; they stay its name, and "Syncing…" its name while it runs.
      pendingLabel={<span className="sr-only">Syncing…</span>}
      className="min-w-(--np-touch) rounded-full px-0"
    >
      <RefreshCwIcon aria-hidden data-icon="inline-start" />
      <span className="sr-only">Sync reviews</span>
    </Button>
  )
}
