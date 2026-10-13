"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

import type { LocationOption } from "@/components/inbox/active-filter-chips"
import { FilterToolbar } from "@/components/inbox/filter-toolbar"
import { QueueTabs } from "@/components/inbox/queue-tabs"
import { useReviewSearch } from "@/components/inbox/review-filters"
import { Skeleton } from "@/components/ui/skeleton"
import { Toolbar } from "@/components/ui/toolbar"
import { ViewHeader } from "@/components/ui/view-header"
import type { ReviewCounts } from "@/lib/contracts/reviews"
import { formatNumber } from "@/lib/format"
import { useBreakpoint } from "@/lib/hooks/use-media-query"
import { SEARCH_FOCUS_EVENT } from "@/lib/inbox/events"
import type { InboxState, Queue } from "@/lib/inbox/url-state"
import { cn } from "@/lib/utils"

/**
 * The count after the title (Notion Mail's "Inbox 99+"): how many reviews
 * need a reply, for `ViewHeader`'s count slot, which draws it beside the h1
 * (never inside it, so the heading's name stays "Inbox" whatever the number
 * is) and says it to a screen reader in words ("12 need a reply", the tab
 * bar's own wording).
 *
 * A skeleton while the counts are in flight, never a "0": a zero before the
 * number lands says there is nothing to do when there may be plenty. A
 * queue with nothing in it shows no figure, as the tab bar does.
 */
function headerCount(
  counts: ReviewCounts | undefined,
  countsPending: boolean
): { count?: ReactNode; countLabel?: string } {
  if (countsPending) {
    return { count: <Skeleton className="inline-block h-5 w-8 align-middle" /> }
  }
  const needsReply = counts?.byQueue?.needs_reply ?? 0
  if (needsReply <= 0) return {}
  return {
    count: formatNumber(needsReply),
    countLabel: `${formatNumber(needsReply)} ${needsReply === 1 ? "needs" : "need"} a reply`,
  }
}

/**
 * The inbox's band above the list, composed from the primitives:
 *
 * - `ViewHeader`: "Inbox" (the page's h1, or a `p` while an open review's
 *   head is the h1), the needs-reply count after it, and the page actions
 *   (shortcuts and sync). From `xl` the reminder sentence sits before them.
 * - `Toolbar`: the review search (Notion Mail's filled pill, "Search
 *   reviews") with the filter end of the band in its filter slot.
 * - The queue strip under it, across the full width.
 *
 * The search is always there rather than folded behind an icon: it is the
 * inbox's one search, and an icon beside the shell's own would be a second
 * magnifier that means something else.
 *
 * Search mode (Notion Mail's search takeover) is the Toolbar's, on a touch
 * layout only (anything that is not `desk`, as the Toolbar decides): focusing
 * the field, or arriving with a search in force, folds the title, the
 * actions, the filters and the queue strip away and puts a "Cancel" beside
 * the field, with the list's count under it as the results label. Cancel
 * (or Escape) empties the field and sends `{ search: "" }` through
 * `onFilterChange` at once. It is not left on blur: a blur that unfolded the
 * strip would move the list under a finger already on its way to a row. The
 * title stays the page's h1 for assistive tech (`sr-only`, not removed).
 * Nothing folds at the desk.
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
  const { searchDraft, setSearchDraft, searchPending, cancel } =
    useReviewSearch(state, onFilterChange)
  // The Toolbar's own test for a touch layout, as a render input: search
  // mode never takes over the desk.
  const touch = !useBreakpoint("desk")
  // Entered by focusing the field (the Toolbar reports it); left only by
  // Cancel or Escape.
  const [searchEngaged, setSearchEngaged] = useState(false)
  // Opening a review (on a phone its head takes the h1) ends an empty
  // search's takeover, so coming back finds the queues and Sync again
  // rather than a Cancel for a search that was never typed.
  const [wasHeading, setWasHeading] = useState(titleIsHeading)
  if (wasHeading !== titleIsHeading) {
    setWasHeading(titleIsHeading)
    if (!titleIsHeading) setSearchEngaged(false)
  }
  const searchMode = touch && (searchEngaged || state.search !== "")

  // `/` from the hotkey layer puts the caret in the search.
  useEffect(() => {
    function onFocusSearch() {
      requestAnimationFrame(() => searchRef.current?.focus())
    }
    window.addEventListener(SEARCH_FOCUS_EVENT, onFocusSearch)
    return () => window.removeEventListener(SEARCH_FOCUS_EVENT, onFocusSearch)
  }, [])

  return (
    <div
      data-slot="inbox-toolbar"
      data-search-mode={searchMode ? "" : undefined}
      className="flex shrink-0 flex-col gap-3"
    >
      <div
        data-slot="inbox-title-row"
        className={cn("min-w-0", searchMode && "sr-only")}
      >
        <ViewHeader
          title="Inbox"
          titleAs={titleIsHeading ? "h1" : "p"}
          {...headerCount(counts, countsPending)}
          actions={
            <div
              hidden={searchMode}
              className="flex min-w-0 items-center justify-end gap-2"
            >
              <p className="min-w-0 truncate text-ui text-ink-muted max-xl:hidden">
                Only verified replies reach Google.
              </p>
              {actions}
            </div>
          }
        />
      </div>

      <Toolbar
        sticky={false}
        className="py-0"
        searchLabel="Search reviews"
        searchPlaceholder="Search reviews"
        searchValue={searchDraft}
        onSearchChange={setSearchDraft}
        searchInputProps={{ "aria-busy": searchPending || undefined }}
        searchRef={searchRef}
        searchMode={searchMode}
        onSearchModeChange={(next) => {
          if (next) {
            setSearchEngaged(true)
            return
          }
          cancel()
          setSearchEngaged(false)
        }}
        filter={
          <FilterToolbar
            state={state}
            resultLabel={resultLabel}
            locations={locations}
            clients={clients}
            showLocationFilter={showLocationFilter}
            onChange={onFilterChange}
            onQueueChange={onQueueChange}
            onClear={onClear}
          />
        }
      />

      {searchMode ? (
        // The results label under the field: the list's own count, so it
        // can never disagree with the rows. Not live (so not the Toolbar's
        // `resultsLabel`, a status): the list header already announces a
        // new count once per search.
        <p
          data-slot="inbox-search-results"
          className="min-w-0 text-ui text-ink-muted"
        >
          Results · {resultLabel}
        </p>
      ) : null}

      <QueueTabs
        queue={state.queue}
        counts={counts}
        countsPending={countsPending}
        onQueueChange={onQueueChange}
        className={cn(searchMode && "hidden")}
      />
    </div>
  )
}

export { InboxToolbar }
