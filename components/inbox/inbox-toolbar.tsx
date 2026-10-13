"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

import type { LocationOption } from "@/components/inbox/active-filter-chips"
import { FilterToolbar } from "@/components/inbox/filter-toolbar"
import { QueueTabs } from "@/components/inbox/queue-tabs"
import { ReviewSearchField } from "@/components/inbox/review-filters"
import { Skeleton } from "@/components/ui/skeleton"
import type { ReviewCounts } from "@/lib/contracts/reviews"
import { formatNumber } from "@/lib/format"
import { SEARCH_FOCUS_EVENT } from "@/lib/inbox/events"
import type { InboxState, Queue } from "@/lib/inbox/url-state"
import { cn } from "@/lib/utils"

/**
 * The count after the title (Notion Mail's "Inbox 99+"): how many reviews
 * need a reply, in the title's size at regular weight and the muted ink.
 *
 * The figure sits BESIDE the h1, not inside it, so the heading's name stays
 * "Inbox" whatever the number is: a heading that renames itself every sync
 * is noisy in a screen reader's heading list, and every test and journey
 * finds the page by that name. The figure is aria-hidden and a sentence
 * ("12 need a reply", the tab bar's own wording) says it instead.
 *
 * A skeleton while the counts are in flight, never a "0": a zero before the
 * number lands says there is nothing to do when there may be plenty. A
 * queue with nothing in it shows no figure, as the tab bar does.
 */
function HeaderCount({
  counts,
  countsPending,
}: {
  counts: ReviewCounts | undefined
  countsPending: boolean
}) {
  if (countsPending) {
    return (
      <Skeleton
        data-slot="inbox-header-count"
        className="h-5 w-8 self-center"
      />
    )
  }
  const needsReply = counts?.byQueue?.needs_reply ?? 0
  if (needsReply <= 0) return null
  return (
    <span data-slot="inbox-header-count" className="shrink-0">
      <span
        aria-hidden
        className="font-display text-section font-normal text-ink-muted tabular-nums md:text-page-title"
      >
        {formatNumber(needsReply)}
      </span>
      <span className="sr-only">
        {formatNumber(needsReply)} {needsReply === 1 ? "needs" : "need"} a reply
      </span>
    </span>
  )
}

/**
 * The inbox's one compact band (reference `.toolbar`). It replaces a page
 * header, a hero count, a chip row and a filter row, so the list starts high
 * on every screen.
 *
 * - From `md`: the title and its count, the search and the page actions on
 *   the first row; the queues and the filters on the second. From `xl` the
 *   reminder sentence sits beside the title.
 * - Phones: three rows on a grid — the title (smaller) with the actions, the
 *   search with the Filters button, then the queue strip across the full
 *   width. The search is always there rather than folded behind an icon: it
 *   is the inbox's one search, and an icon beside the shell's own would be a
 *   second magnifier that means something else. The two row wrappers step
 *   aside (`display: contents`) so their children land on the grid.
 * - Phone search mode (Notion Mail's search takeover): focusing the field,
 *   or arriving with a search in force, folds the title row and the queue
 *   strip away and puts a "Cancel" beside the field (the two span the
 *   width), with the list's count under it as the results label and the
 *   Filters button at that line's end. Cancel empties the field through its own
 *   draft (the same debounced path as typing) and brings the strip back.
 *   The title stays the page's h1 for assistive tech (`sr-only`, not
 *   removed). Nothing moves at the desk.
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
  // Entered by focusing the field; left only by Cancel. Not on blur: a blur
  // that unfolded the strip would move the list under a finger that is
  // already on its way to a row.
  const [searchEngaged, setSearchEngaged] = useState(false)
  // Opening a review (on a phone its head takes the h1) ends an empty
  // search's takeover, so coming back finds the queues and Sync again
  // rather than a Cancel for a search that was never typed.
  const [wasHeading, setWasHeading] = useState(titleIsHeading)
  if (wasHeading !== titleIsHeading) {
    setWasHeading(titleIsHeading)
    if (!titleIsHeading) setSearchEngaged(false)
  }
  const searchMode = searchEngaged || state.search !== ""

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
      data-search-mode={searchMode ? "" : undefined}
      className="flex shrink-0 flex-col gap-3 max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-2 max-md:gap-y-2.5"
    >
      <div className="flex min-w-0 items-center gap-3 max-md:contents">
        <div
          data-slot="inbox-title-row"
          className={cn(
            "flex min-w-0 flex-1 items-baseline gap-3 max-md:col-start-1 max-md:row-start-1",
            searchMode && "max-md:sr-only"
          )}
        >
          <div className="flex min-w-0 items-baseline gap-2">
            <Title className="font-display text-section font-semibold text-ink md:text-page-title">
              Inbox
            </Title>
            <HeaderCount counts={counts} countsPending={countsPending} />
          </div>
          <p className="min-w-0 truncate text-ui text-ink-muted max-xl:hidden">
            Only verified replies reach Google.
          </p>
        </div>

        <ReviewSearchField
          ref={searchRef}
          state={state}
          onChange={onFilterChange}
          showShortcut
          showCancel={searchMode}
          onFocus={() => setSearchEngaged(true)}
          onCancel={() => setSearchEngaged(false)}
          className={cn(
            "shrink md:w-56 lg:w-72",
            searchMode
              ? "max-md:col-span-2 max-md:row-start-1"
              : "max-md:col-start-1 max-md:row-start-2"
          )}
        />

        {actions ? (
          <div
            className={cn(
              "flex shrink-0 items-center justify-end gap-2 max-md:col-start-2 max-md:row-start-1",
              searchMode && "max-md:hidden"
            )}
          >
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
          className={cn(
            "max-md:col-span-2 max-md:row-start-3",
            searchMode && "max-md:hidden"
          )}
        />
        {searchMode ? (
          // The results label under the field: the list's own count, so it
          // can never disagree with the rows. Not live: the list header
          // already announces a new count once per search.
          <p
            data-slot="inbox-search-results"
            className="min-w-0 self-center text-ui text-ink-muted max-md:col-start-1 max-md:row-start-2 md:hidden"
          >
            Results · {resultLabel}
          </p>
        ) : null}
        <FilterToolbar
          state={state}
          resultLabel={resultLabel}
          locations={locations}
          clients={clients}
          showLocationFilter={showLocationFilter}
          onChange={onFilterChange}
          onQueueChange={onQueueChange}
          onClear={onClear}
          className={cn("flex-1 max-md:col-start-2 max-md:row-start-2")}
        />
      </div>
    </header>
  )
}

export { InboxToolbar }
