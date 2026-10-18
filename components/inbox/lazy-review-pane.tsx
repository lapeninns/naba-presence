"use client"

import dynamic from "next/dynamic"
import * as React from "react"

import { whileLoading } from "@/components/inbox/lazy-dialog-boundary"
import type {
  ReviewPane as ReviewPaneType,
  ReviewPaneProps,
} from "@/components/inbox/review-pane"
import { Skeleton } from "@/components/ui/skeleton"

// The open review, its composer and its publish bar are drawn only once a
// review is selected, so their code is not part of the list's first load: a
// phone opened on /inbox shows the list alone. It still renders on the server
// (ssr stays on), so a page opened on `?selected=` names the chunk in its
// HTML and paints the review as before.

/** The pane itself once its code is in memory; null until then. */
let loadedPane: typeof ReviewPaneType | null = null
/** Set after the Inbox first commits, so hydration never takes the fast path. */
let hydrated = false

const loadReviewPane = () =>
  import("@/components/inbox/review-pane").then((m) => {
    loadedPane = m.ReviewPane
    return m
  })
const createReviewPane = () =>
  dynamic<ReviewPaneProps>(() => loadReviewPane().then((m) => m.ReviewPane), {
    // `whileLoading` rethrows a failed load, which one of next/dynamic's
    // runtimes hands to `loading` instead of throwing, so it always reaches
    // the DetailErrorBoundary rather than leaving the skeleton up.
    loading: whileLoading(
      <div className="flex flex-col gap-3 px-(--np-page-pad-x) py-(--np-card-pad) md:px-7">
        <span role="status" className="sr-only">
          Loading the review…
        </span>
        <Skeleton aria-hidden className="h-5 w-40" />
        <Skeleton aria-hidden className="h-4 w-2/3" />
        <Skeleton aria-hidden className="h-4 w-1/2" />
      </div>
    ),
  })

const lazyPane = { Pane: createReviewPane() }

/**
 * After the pane's code failed to load: React caches a rejected load for the
 * life of a lazy component, so "Try again" needs a fresh one to ask afresh.
 */
function reloadReviewPane() {
  lazyPane.Pane = createReviewPane()
}

/**
 * Once the browser is idle after the list, fetch the pane's code so that the
 * first tap on a review opens it as fast as before the split. Nothing
 * depends on this: a failure, or a browser that never goes idle, only means
 * the code is fetched on the first open instead.
 */
function useIdlePreloadReviewPane() {
  React.useEffect(() => {
    hydrated = true
    const preload = () => void loadReviewPane().catch(() => {})
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(preload, { timeout: 4000 })
      return () => window.cancelIdleCallback(handle)
    }
    const handle = window.setTimeout(preload, 2000)
    return () => window.clearTimeout(handle)
  }, [])
}

/**
 * The open review. When its code is already in memory it mounts directly:
 * a lazy component would still suspend once, show the fallback and only then
 * start the review's own read, which put most of a second between the tap
 * and the review. Which path a pane takes is fixed when it mounts (each
 * review mounts its own, keyed by id), so a draft is never remounted, and
 * hydration always takes the lazy path the server rendered.
 */
function LazyReviewPane(props: ReviewPaneProps) {
  const [Direct] = React.useState(() => (hydrated ? loadedPane : null))
  if (Direct) return <Direct {...props} />
  return <lazyPane.Pane {...props} />
}

export { LazyReviewPane, reloadReviewPane, useIdlePreloadReviewPane }
