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
import { queryKeys } from "@/lib/queries/keys"

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
  const [error, setError] = useState<string | null>(null)
  if (!canSync) return null

  async function run() {
    setPending(true)
    setError(null)
    // The organisation's review total as this page last had it. The sync
    // route reports what it wrote, which includes every unchanged review on
    // Google's newest page, so "new" is the difference in the total instead.
    const countsKey = queryKeys.reviewCounts("organisation")
    const before = queryClient.getQueryData<ReviewCounts>(countsKey)?.total
    try {
      const result = await triggerReviewSync()
      if (result.skipped) {
        setError("A sync is already running. Try again in a moment.")
        return
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.reviewsAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.reviewCountsAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.clientsAll }),
      ])
      const failure = result.failures?.[0]?.errorCode
      if (failure) {
        setError(describeActionError(new ApiClientError(502, failure, failure)))
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
      toasts.add(
        added === null
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
              }
      )
    } catch (caught) {
      setError(describeActionError(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="relative flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void run()}
        pending={pending}
        pendingLabel="Syncing…"
      >
        <RefreshCwIcon aria-hidden data-icon="inline-start" />
        {/* The words fold away on a phone; they stay the button's name. */}
        <span className="max-md:sr-only">Sync reviews</span>
      </Button>
      {error ? (
        <span
          role="alert"
          className="max-w-72 text-caption text-danger-ink max-md:absolute max-md:top-full max-md:right-0 max-md:z-10 max-md:w-60 max-md:rounded-(--np-radius-control) max-md:bg-surface max-md:p-2 max-md:shadow-np-pop sm:text-right"
        >
          {error}
        </span>
      ) : null}
    </div>
  )
}
