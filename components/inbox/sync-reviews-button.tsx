"use client"

import { RefreshCwIcon } from "lucide-react"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { useToastManager } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import { fetchReviewCounts, type ReviewCounts } from "@/lib/api/review-counts"
import { triggerReviewSync, type ReviewSyncResult } from "@/lib/api/sync"
import { describeActionError, errorOutcome } from "@/lib/errors/action-errors"
import { formatNumber } from "@/lib/format"
import { invalidateReviewBatch } from "@/lib/queries/invalidate"
import { queryKeys } from "@/lib/queries/keys"

// Every outcome of this control is "the latest sync result": one id, so a
// toast replaces the one before it instead of stacking beside it ("Could not
// sync reviews" and "Up to date" together after a retry). The progress
// toast takes the same id, so the result replaces it in place.
const SYNC_TOAST_ID = "sync-reviews"

/**
 * The reconcile route's answer to a person's sync, as it already sends it:
 * each failure names its listing (null for one that is not a listing's, an
 * audit write), and `locations` lists the listings walked, failed or not.
 * Read here only, to tell "some listings could not be checked" from "the
 * sync failed"; `lib/api/sync.ts` keeps its narrower type.
 */
type ReconcileReply = Omit<ReviewSyncResult, "failures"> & {
  failures?: Array<{ errorCode: string; externalLocationId?: string | null }>
  locations?: Array<{
    externalLocationId: string
    status: "succeeded" | "partial" | "failed"
  }>
}

// Codes the shared copy words for another context (replying, linking), in
// the sync's own terms. Anything else falls back to the shared copy.
const SYNC_FAILURE_COPY: Record<string, string> = {
  location_not_verified: "Google hasn’t verified a listing yet.",
  google_reconnect_required:
    "A Google login needs reconnecting in Settings › Google connections.",
  location_not_linked: "A listing is no longer linked to Google.",
  google_location_not_linked: "A listing is no longer linked to Google.",
}

/**
 * Failures a second press could get past: Google or the service was briefly
 * unavailable. Not a rate limit, a pause, a refusal or a lost login, which a
 * retry cannot fix and would only spend the sync budget on.
 */
const RETRYABLE_CODES = new Set([
  "google_unavailable",
  "google_token_unavailable",
  "internal_error",
  "sync_failed",
])

function describeSyncFailure(code: string) {
  return (
    SYNC_FAILURE_COPY[code] ??
    describeActionError(new ApiClientError(502, code, code))
  )
}

function canRetry(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.reconnectRequired || error.code === "sync_paused") return false
    return error.status >= 500 || RETRYABLE_CODES.has(error.code)
  }
  // No answer at all (offline, timed out): pressing again is the way on.
  return true
}

/** Whole minutes from the 429's `details.retryAfter` (seconds), if it has one. */
function retryAfterMinutes(error: ApiClientError) {
  const seconds = (error.details as { retryAfter?: unknown } | undefined)
    ?.retryAfter
  if (typeof seconds !== "number" || !(seconds > 0)) return null
  return Math.max(1, Math.ceil(seconds / 60))
}

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
  // than a caption under the icon that stayed until the next sync. "Try
  // again" only where a second press could work; it is one more request,
  // counted by the server like any press, and never sent by itself.
  const fail = (description: string, { retry }: { retry: boolean }) =>
    toasts.add({
      id: SYNC_TOAST_ID,
      title: "Could not sync reviews",
      description,
      type: "error",
      ...(retry
        ? { actionProps: { children: "Try again", onClick: () => void run() } }
        : {}),
    })

  async function run() {
    setPending(true)
    // A walk of every listing can take most of a minute: say so at once,
    // in the toast the result will replace (a polite live region, so it is
    // spoken), rather than only spinning the icon.
    toasts.add({
      id: SYNC_TOAST_ID,
      type: "loading",
      timeout: 0,
      title: "Checking Google for new reviews…",
      description: "This can take up to a minute. You can keep working.",
    })
    // The organisation's review total as this page last had it. The sync
    // route reports what it wrote, which includes every unchanged review on
    // Google's newest page, so "new" is the difference in the total instead.
    const countsKey = queryKeys.reviewCounts("organisation")
    const before = queryClient.getQueryData<ReviewCounts>(countsKey)?.total
    try {
      const result = (await triggerReviewSync()) as ReconcileReply
      if (result.skipped) {
        // Another check holds the lock: what the person asked for is
        // happening, so it is news, not an error.
        toasts.add({
          id: SYNC_TOAST_ID,
          title: "Already checking Google",
          description:
            "A check that started a moment ago is still running. Sync again in a minute to see what it found.",
          type: "info",
        })
        return
      }
      // In the background: the toast waits only on the counts read below,
      // which joins the counts refetch this starts rather than sending a
      // second request.
      invalidateReviewBatch(queryClient)
      const failures = result.failures ?? []
      const failure = failures[0]?.errorCode
      // Listings, by id: those walked, and those that failed (a listing
      // that threw is in `failures` only).
      const walked = new Set(
        (result.locations ?? []).map((location) => location.externalLocationId)
      )
      const failed = new Set(
        failures.flatMap((entry) =>
          entry.externalLocationId ? [entry.externalLocationId] : []
        )
      )
      const listings = new Set([...walked, ...failed]).size
      // Listings Google had more reviews for than this sync read (its page
      // cap or time budget ran out mid-listing): not "up to date". Listings
      // the walk never reached before its time budget are not in the answer
      // at all, so "Up to date" below speaks only for the ones checked.
      const partial = (result.locations ?? []).filter(
        (location) => location.status === "partial"
      ).length
      const partialNote =
        partial > 0
          ? `Google had more reviews than this sync could read for ${formatNumber(partial)} ${partial === 1 ? "listing" : "listings"}. Scheduled checks keep running.`
          : null
      // Some listings were checked and some were not: the sync ran, and
      // the result says so, with the ones it could not reach.
      const someChecked =
        failure !== undefined &&
        failed.size > 0 &&
        failed.size < listings &&
        failures.every((entry) => entry.externalLocationId)
      if (failure && !someChecked) {
        fail(describeSyncFailure(failure), {
          retry: RETRYABLE_CODES.has(failure),
        })
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
      const found: { title: string; description: string | undefined } =
        added === null
          ? partialNote
            ? { title: "Reviews partly synced", description: partialNote }
            : { title: "Reviews synced", description: undefined }
          : added === 0
            ? partialNote
              ? { title: "No new reviews so far", description: partialNote }
              : {
                  title: "Up to date",
                  description:
                    "Google has no newer reviews for the listings checked.",
                }
            : {
                title: `${formatNumber(added)} new ${added === 1 ? "review" : "reviews"}`,
                // Not "in the list": a filter, queue or client scope can
                // hide them from the one on screen.
                description: partialNote
                  ? `Added to your Inbox. ${partialNote}`
                  : "Added to your Inbox.",
              }
      if (failure && someChecked) {
        const unchecked = `${formatNumber(failed.size)} of ${formatNumber(listings)} listings couldn’t be checked. ${describeSyncFailure(failure)}`
        toasts.add({
          id: SYNC_TOAST_ID,
          title: found.title,
          description: found.description
            ? `${found.description} ${unchecked}`
            : unchecked,
          type: "warning",
          ...(RETRYABLE_CODES.has(failure)
            ? {
                actionProps: {
                  children: "Try again",
                  onClick: () => void run(),
                },
              }
            : {}),
        })
        return
      }
      toasts.add({
        id: SYNC_TOAST_ID,
        ...found,
        type: partialNote ? "info" : "success",
      })
    } catch (caught) {
      if (
        caught instanceof ApiClientError &&
        caught.code === "sync_rate_limited"
      ) {
        const minutes = retryAfterMinutes(caught)
        fail(
          minutes === null
            ? describeActionError(caught)
            : `You’ve synced several times in the last few minutes. Scheduled checks keep running; try again in ${minutes} min.`,
          { retry: false }
        )
        return
      }
      // No answer, or none the app wrote (a proxy timeout, a dropped
      // connection): the walk may have finished on the server. An error
      // the app itself answered with stays a failure.
      if (
        errorOutcome(caught) === "uncertain" &&
        !(caught instanceof ApiClientError && caught.code === "internal_error")
      ) {
        invalidateReviewBatch(queryClient)
        toasts.add({
          id: SYNC_TOAST_ID,
          title: "Check may still be finishing",
          description:
            "We didn’t hear back in time. Try again in a minute to see what it found.",
          type: "warning",
          actionProps: { children: "Try again", onClick: () => void run() },
        })
        return
      }
      fail(describeActionError(caught), { retry: canRetry(caught) })
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      variant="ghost"
      onClick={() => void run()}
      pending={pending}
      // A square 44px icon button at every width; the words are its name,
      // and "Syncing…" its name while it runs (the toast says it aloud).
      pendingLabel={<span className="sr-only">Syncing…</span>}
      className="min-w-(--np-touch) rounded-full px-0"
    >
      <RefreshCwIcon aria-hidden data-icon="inline-start" />
      <span className="sr-only">Sync reviews</span>
    </Button>
  )
}
