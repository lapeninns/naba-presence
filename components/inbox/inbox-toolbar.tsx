"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { SearchIcon, XIcon } from "lucide-react"

import type { LocationOption } from "@/components/inbox/active-filter-chips"
import { FilterToolbar } from "@/components/inbox/filter-toolbar"
import { QueueTabs } from "@/components/inbox/queue-tabs"
import { ReviewSearchField } from "@/components/inbox/review-filters"
import { Button } from "@/components/ui/button"
import type { ReviewCounts } from "@/lib/contracts/reviews"
import { SEARCH_FOCUS_EVENT } from "@/lib/inbox/events"
import type { InboxState, Queue } from "@/lib/inbox/url-state"
import { cn } from "@/lib/utils"

/**
 * The inbox's one compact band (reference `.toolbar`): the title, the search
 * and the page actions on the first row; the queues and the filters on the
 * second. It replaces a page header, a hero count, a chip row and a filter
 * row, so the list starts high on every screen.
 *
 * - 1280px and up: the reminder sentence sits beside the title.
 * - Phones: the search folds behind an icon and opens onto its own line; the
 *   actions shrink to icons; the queue track takes the second row with the
 *   Filters button.
 */
function InboxToolbar({
  state,
  counts,
  countsPending,
  locations,
  clients,
  showLocationFilter,
  actions,
  onFilterChange,
  onQueueChange,
  onClear,
}: {
  state: InboxState
  counts: ReviewCounts | undefined
  countsPending: boolean
  locations: LocationOption[]
  clients: { id: string; name: string }[]
  showLocationFilter: boolean
  /** Page actions from the route: shortcuts and sync. */
  actions?: ReactNode
  onFilterChange: (partial: Partial<InboxState>) => void
  onQueueChange: (queue: Queue) => void
  onClear: () => void
}) {
  const searchRef = useRef<HTMLInputElement>(null)
  // Only means anything on a phone, where the field is folded away. A search
  // already in the URL keeps it open so the words that narrow the list show.
  const [searchOpen, setSearchOpen] = useState(false)
  const showSearch = searchOpen || state.search !== ""

  // `/` from the hotkey layer: unfold the field if it is folded, then focus.
  useEffect(() => {
    function onFocusSearch() {
      setSearchOpen(true)
      requestAnimationFrame(() => searchRef.current?.focus())
    }
    window.addEventListener(SEARCH_FOCUS_EVENT, onFocusSearch)
    return () => window.removeEventListener(SEARCH_FOCUS_EVENT, onFocusSearch)
  }, [])

  return (
    <header
      data-slot="inbox-toolbar"
      className="flex shrink-0 flex-col gap-3 max-md:gap-2.5"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2.5">
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <h1 className="font-display text-[clamp(22px,1.1vw+15px,28px)] leading-[1.18] font-semibold text-ink">
            Inbox
          </h1>
          <p className="min-w-0 truncate text-[13px] text-ink-muted max-xl:hidden">
            Only verified replies reach Google.
          </p>
        </div>

        <ReviewSearchField
          ref={searchRef}
          state={state}
          onChange={onFilterChange}
          showShortcut
          className={cn(
            "flex-[0_1_300px] max-lg:flex-[0_1_220px]",
            // On a phone the field is its own line under the title, and only
            // while it is open.
            "max-md:order-last max-md:basis-full",
            !showSearch && "max-md:hidden"
          )}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={showSearch ? "Close search" : "Search reviews"}
          aria-expanded={showSearch}
          onClick={() => {
            if (showSearch) {
              setSearchOpen(false)
              if (state.search) onFilterChange({ search: "" })
              return
            }
            setSearchOpen(true)
            requestAnimationFrame(() => searchRef.current?.focus())
          }}
          className="md:hidden"
        >
          {showSearch ? (
            <XIcon aria-hidden strokeWidth={1.75} />
          ) : (
            <SearchIcon aria-hidden strokeWidth={1.75} />
          )}
        </Button>

        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>

      <div className="flex min-w-0 items-center gap-2 md:gap-3">
        <QueueTabs
          queue={state.queue}
          counts={counts}
          countsPending={countsPending}
          onQueueChange={onQueueChange}
          className="max-md:flex-1"
        />
        <FilterToolbar
          state={state}
          locations={locations}
          clients={clients}
          showLocationFilter={showLocationFilter}
          onChange={onFilterChange}
          onQueueChange={onQueueChange}
          onClear={onClear}
          className="flex-1 max-md:flex-none"
        />
      </div>
    </header>
  )
}

export { InboxToolbar }
