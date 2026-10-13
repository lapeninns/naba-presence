"use client"

import { useEffect, useRef, type ReactNode } from "react"

import type { LocationOption } from "@/components/inbox/active-filter-chips"
import { FilterToolbar } from "@/components/inbox/filter-toolbar"
import { QueueTabs } from "@/components/inbox/queue-tabs"
import { ReviewSearchField } from "@/components/inbox/review-filters"
import type { ReviewCounts } from "@/lib/contracts/reviews"
import { SEARCH_FOCUS_EVENT } from "@/lib/inbox/events"
import type { InboxState, Queue } from "@/lib/inbox/url-state"

/**
 * The inbox's one compact band (reference `.toolbar`). It replaces a page
 * header, a hero count, a chip row and a filter row, so the list starts high
 * on every screen.
 *
 * - From `md`: the title, the search and the page actions on the first row;
 *   the queues and the filters on the second. From `xl` the reminder
 *   sentence sits beside the title.
 * - Phones: three rows on a grid — the title (smaller) with the actions, the
 *   search with the Filters button, then the queue strip across the full
 *   width. The search is always there rather than folded behind an icon: it
 *   is the inbox's one search, and an icon beside the shell's own would be a
 *   second magnifier that means something else. The two row wrappers step
 *   aside (`display: contents`) so their children land on the grid.
 */
function InboxToolbar({
  state,
  counts,
  countsPending,
  locations,
  clients,
  showLocationFilter,
  actions,
  resultLabel,
  onFilterChange,
  onQueueChange,
  onClear,
  titleIsHeading = true,
}: {
  state: InboxState
  counts: ReviewCounts | undefined
  countsPending: boolean
  locations: LocationOption[]
  clients: { id: string; name: string }[]
  showLocationFilter: boolean
  /** Page actions from the route: shortcuts and sync. */
  actions?: ReactNode
  /**
   * The list's count label ("12 reviews", "50 reviews so far", "Loading
   * reviews…"), which the Filters sheet turns into its "Show 12 reviews".
   */
  resultLabel: string
  onFilterChange: (partial: Partial<InboxState>) => void
  onQueueChange: (queue: Queue) => void
  onClear: () => void
  /**
   * Whether "Inbox" is the page's h1. Not while the open review's head is
   * the h1 instead (a phone showing a review); see InboxViewInner.
   */
  titleIsHeading?: boolean
}) {
  const searchRef = useRef<HTMLInputElement>(null)
  const Title = titleIsHeading ? "h1" : "p"

  // `/` from the hotkey layer puts the caret in the search.
  useEffect(() => {
    function onFocusSearch() {
      requestAnimationFrame(() => searchRef.current?.focus())
    }
    window.addEventListener(SEARCH_FOCUS_EVENT, onFocusSearch)
    return () => window.removeEventListener(SEARCH_FOCUS_EVENT, onFocusSearch)
  }, [])

  return (
    <header
      data-slot="inbox-toolbar"
      className="flex shrink-0 flex-col gap-3 max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-2 max-md:gap-y-2.5"
    >
      <div className="flex min-w-0 items-center gap-3 max-md:contents">
        <div className="flex min-w-0 flex-1 items-baseline gap-3 max-md:col-start-1 max-md:row-start-1">
          <Title className="font-display text-section font-semibold text-ink md:text-page-title">
            Inbox
          </Title>
          <p className="min-w-0 truncate text-ui text-ink-muted max-xl:hidden">
            Only verified replies reach Google.
          </p>
        </div>

        <ReviewSearchField
          ref={searchRef}
          state={state}
          onChange={onFilterChange}
          showShortcut
          className="shrink max-md:col-start-1 max-md:row-start-2 md:w-56 lg:w-72"
        />

        {actions ? (
          <div className="flex shrink-0 items-center justify-end gap-2 max-md:col-start-2 max-md:row-start-1">
            {actions}
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 items-center gap-3 max-md:contents">
        <QueueTabs
          queue={state.queue}
          counts={counts}
          countsPending={countsPending}
          onQueueChange={onQueueChange}
          className="max-md:col-span-2 max-md:row-start-3"
        />
        <FilterToolbar
          state={state}
          resultLabel={resultLabel}
          locations={locations}
          clients={clients}
          showLocationFilter={showLocationFilter}
          onChange={onFilterChange}
          onQueueChange={onQueueChange}
          onClear={onClear}
          className="flex-1 max-md:col-start-2 max-md:row-start-2"
        />
      </div>
    </header>
  )
}

export { InboxToolbar }
