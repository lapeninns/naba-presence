"use client"

import { RefreshCwIcon } from "lucide-react"
import dynamic from "next/dynamic"
import * as React from "react"

import {
  LazyDialogBoundary,
  whileLoading,
} from "@/components/inbox/lazy-dialog-boundary"
import { useSelection } from "@/components/inbox/selection-context"
import { DockSpacer } from "@/components/ui/action-bar"
import { Button } from "@/components/ui/button"
import type { ReviewRow } from "@/lib/contracts/reviews"

// The bulk bar brings the bulk menus, the confirmations and the triage
// helpers with it, and matters only once something is ticked, so its code is
// not part of the Inbox's first load and is not asked for while nothing is
// selected. It is client-only: there is never a selection on the server.
const loadBulkActionBar = () => import("@/components/inbox/bulk-action-bar")
// React caches a failed load for the life of a lazy component, so after one
// a fresh component replaces it.
const createBulkActionBar = () =>
  dynamic(() => loadBulkActionBar().then((module) => module.BulkActionBar), {
    ssr: false,
    loading: whileLoading(
      <span role="status" className="sr-only">
        Loading the selection actions…
      </span>
    ),
  })
const lazyBar = { Bar: createBulkActionBar() }

/**
 * Where "Try again" parked focus while the retry runs, for the notice to
 * claim if the load fails once more. Only one bar exists, so one place.
 */
const parkedFocus: { element: HTMLElement | null } = { element: null }

/** The list header's one way out of a selection: always there while the bar is. */
function selectionCancelButton(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-slot="inbox-list-header"] button[aria-label="Cancel selection"]'
  )
}

/** "Try again" on the notice; takes focus back if it was parked while retrying. */
function LoadFailedNotice({ onRetry }: { onRetry: () => void }) {
  const retryRef = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    const parked = parkedFocus.element
    if (!parked) return
    parkedFocus.element = null
    const active = document.activeElement
    // Only if focus is still where the retry left it: not if the operator
    // has since gone elsewhere.
    if (active === document.body || active === parked) retryRef.current?.focus()
  }, [])
  return (
    // Plain markup in the list's own "More reviews below" strip (pinned to the
    // bottom edge on a phone, as the bar it stands in for is), not the
    // SelectionBar: that module belongs to the bar's chunk, and importing it
    // here for a notice most people never see would put it back in the
    // Inbox's first load.
    <>
      {/* Keeps the last row reachable above the fixed notice (phone only), and
          moves the toasts and scroll padding clear of it, as for any docked
          bar. The ActionBar's spacer, already in the Inbox's first load. */}
      <DockSpacer data-slot="bulk-action-bar-failed-spacer" />
      <div
        role="region"
        aria-label="Selection actions"
        data-slot="bulk-action-bar-failed"
        // The tab bar steps aside for a docked bar (globals.css), phone only.
        data-docked="bottom"
        className="z-chrome flex shrink-0 items-center justify-between gap-2 border-t border-line-subtle bg-surface py-1 pr-1 pl-(--np-page-pad-x) max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:pb-[max(--spacing(1),var(--np-dock-bottom))]"
      >
        <p role="alert" className="text-caption text-ink-muted">
          The selection actions could not load.
        </p>
        <Button ref={retryRef} variant="ghost" onClick={onRetry}>
          <RefreshCwIcon aria-hidden />
          Try again
        </Button>
      </div>
    </>
  )
}

/**
 * Once the browser is idle, fetch the bar's code so that the first tick finds
 * it. Nothing depends on this: a failure, or a browser that never goes idle,
 * only means the bar is fetched on the first tick instead.
 */
function useIdlePreload() {
  React.useEffect(() => {
    const preload = () => void loadBulkActionBar().catch(() => {})
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(preload, { timeout: 4000 })
      return () => window.cancelIdleCallback(handle)
    }
    const handle = window.setTimeout(preload, 2000)
    return () => window.clearTimeout(handle)
  }, [])
}

/**
 * The bulk bar, loaded when it is first needed.
 *
 * - Nothing selected, nothing drawn, and the code is not required: it is
 *   asked for when the first row is ticked. (The browser's idle time is used
 *   to fetch it ahead, which only warms the cache and never mounts the bar.)
 *   Once the bar has been shown it stays mounted: it owns the template
 *   batch's dialog, which outlives the selection (sent replies leave the list
 *   under it), and the receipt of a batch the bulk engine queued.
 * - If its code cannot be fetched the Inbox carries on: the list, the open
 *   review and the selection are untouched. A toast says so and the bar's
 *   place holds a short notice with "Try again", which asks for the code
 *   afresh. The notice goes when the selection is emptied, and the next
 *   selection tries again by itself. Focus never drops to the page: "Try
 *   again" parks it on the list header's "Cancel selection" (which outlives
 *   the notice) and brings it back to the new "Try again" if the load fails
 *   once more.
 */
function LazyBulkActionBar({
  rows,
  bulkEngine,
  scopeKey,
  hasMore,
}: {
  rows: ReviewRow[]
  bulkEngine?: boolean
  /** The client the list is scoped to (see BulkActionBar). */
  scopeKey?: string
  /** More reviews follow the loaded `rows` (see BulkActionBar). */
  hasMore?: boolean
}) {
  useIdlePreload()
  const { selected } = useSelection()
  const hasSelection = selected.size > 0
  const [armed, setArmed] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    if (!hasSelection) parkedFocus.element = null
  }, [hasSelection])

  if (hasSelection && !armed && !failed) setArmed(true)
  if (!hasSelection && failed) setFailed(false)

  if (failed) {
    return (
      <LoadFailedNotice
        onRetry={() => {
          // The notice is about to go: park focus on something that stays.
          const parked = selectionCancelButton()
          parked?.focus()
          parkedFocus.element = parked
          lazyBar.Bar = createBulkActionBar()
          setFailed(false)
          setArmed(true)
        }}
      />
    )
  }
  if (!armed) return null
  return (
    <LazyDialogBoundary
      what="the selection actions"
      onFail={() => {
        lazyBar.Bar = createBulkActionBar()
        setArmed(false)
        setFailed(true)
      }}
    >
      <lazyBar.Bar
        rows={rows}
        bulkEngine={bulkEngine}
        scopeKey={scopeKey}
        hasMore={hasMore}
      />
    </LazyDialogBoundary>
  )
}

export { LazyBulkActionBar }
