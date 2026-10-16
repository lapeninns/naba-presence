"use client"

import { RefreshCwIcon } from "lucide-react"
import dynamic from "next/dynamic"
import * as React from "react"

import {
  LazyDialogBoundary,
  whileLoading,
} from "@/components/inbox/lazy-dialog-boundary"
import { useSelection } from "@/components/inbox/selection-context"
import { SelectionBar, SelectionBarTile } from "@/components/ui/selection-bar"
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
 * - Nothing selected, nothing drawn and nothing downloaded. Once the bar has
 *   been shown it stays mounted: it owns the template batch's dialog, which
 *   outlives the selection (sent replies leave the list under it).
 * - If its code cannot be fetched the Inbox carries on: the list, the open
 *   review and the selection are untouched. A toast says so and the bar's
 *   place holds a short notice with "Try again", which asks for the code
 *   afresh. The notice goes when the selection is emptied, and the next
 *   selection tries again by itself.
 */
function LazyBulkActionBar({
  rows,
  bulkEngine,
}: {
  rows: ReviewRow[]
  bulkEngine?: boolean
}) {
  useIdlePreload()
  const { selected } = useSelection()
  const hasSelection = selected.size > 0
  const [armed, setArmed] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  if (hasSelection && !armed && !failed) setArmed(true)
  if (!hasSelection && failed) setFailed(false)

  if (failed) {
    return (
      <SelectionBar
        data-slot="bulk-action-bar-failed"
        label="Selection actions"
        notes={<p role="alert">The selection actions could not load.</p>}
        className="shrink-0"
      >
        <SelectionBarTile
          icon={<RefreshCwIcon aria-hidden />}
          label="Try again"
          onClick={() => {
            lazyBar.Bar = createBulkActionBar()
            setFailed(false)
            setArmed(true)
          }}
        />
      </SelectionBar>
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
      <lazyBar.Bar rows={rows} bulkEngine={bulkEngine} />
    </LazyDialogBoundary>
  )
}

export { LazyBulkActionBar }
