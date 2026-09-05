"use client"

import { useEffect, useId, useState } from "react"

import { ActiveFilterChips } from "@/components/inbox/active-filter-chips"
import {
  AdvancedFilters,
  MoreFiltersToggle,
  RatingFilter,
  ReplyFilter,
  advancedFilterCount,
} from "@/components/inbox/filter-controls"
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
} from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { LocationOption } from "@/components/inbox/active-filter-chips"
import {
  DEFAULT_REVIEW_SORT,
  REVIEW_SORT_LABELS,
  REVIEW_SORTS,
  isReviewSort,
} from "@/lib/contracts/reviews"
import type { InboxState } from "@/lib/inbox/url-state"
import { cn } from "@/lib/utils"

// `<Select.Value>` resolves its displayed label from the root's `items` map
// (a plain `{ value: label }` record) rather than from the rendered
// `SelectItem` children — without it, the trigger would show the raw stored
// value ("updated_desc") instead of the sentence-case label. Both the map and
// the rendered items come from the contract's sort vocabulary.

/**
 * Search and sort: the strip that belongs at the head of the list, the way
 * Mail keeps its search field above the messages rather than in the sidebar.
 * Search is debounced into the URL; the local draft follows the URL when it
 * is cleared from elsewhere ("Clear filters", the chip's remove button).
 */
function ReviewSearchBar({
  state,
  onChange,
  className,
}: {
  state: InboxState
  onChange: (partial: Partial<InboxState>) => void
  className?: string
}) {
  const searchId = useId()
  const [searchDraft, setSearchDraft] = useState(state.search)
  // "Adjusting state when a prop changes" (react.dev/learn/you-might-not-need-an-effect):
  // setting state during render — not inside an effect body — keeps this a single
  // render pass instead of triggering the cascading-render lint (and an extra paint).
  const [syncedSearch, setSyncedSearch] = useState(state.search)
  if (state.search !== syncedSearch) {
    setSyncedSearch(state.search)
    setSearchDraft(state.search)
  }
  useEffect(() => {
    if (searchDraft === state.search) return
    const timer = setTimeout(() => onChange({ search: searchDraft }), 300)
    return () => clearTimeout(timer)
  }, [searchDraft, state.search, onChange])

  const searchPending = searchDraft !== state.search

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <label htmlFor={searchId} className="sr-only">
        Search reviews
      </label>
      <Input
        id={searchId}
        type="search"
        role="searchbox"
        aria-label="Search reviews"
        aria-busy={searchPending || undefined}
        value={searchDraft}
        placeholder="Search reviews"
        onChange={(event) => setSearchDraft(event.target.value)}
        className="min-w-0 flex-1"
      />

      <Select
        value={state.sort}
        onValueChange={(value: string | null) =>
          onChange({
            sort: value && isReviewSort(value) ? value : DEFAULT_REVIEW_SORT,
          })
        }
        items={REVIEW_SORT_LABELS}
      >
        <SelectTrigger aria-label="Sort reviews" className="shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {REVIEW_SORTS.map((sort) => (
            <SelectItem key={sort} value={sort}>
              {REVIEW_SORT_LABELS[sort]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/**
 * Every filter the inbox has. By default it is the whole set — search and
 * sort at the top, the chips of what is applied at the bottom — so it can
 * stand alone. The workspace splits it: `showSearch={false}` puts the rest
 * in the rail while `ReviewSearchBar` heads the list, and `showChips={false}`
 * lets the list show the applied chips next to the rows they narrow.
 */
function ReviewFilters({
  state,
  locations,
  showLocationFilter = true,
  showSearch = true,
  showChips = true,
  onChange,
  onClear,
  className,
}: {
  state: InboxState
  locations: LocationOption[]
  // Server-resolved; see the note on InboxView in inbox-view.tsx for why this
  // is not derived from `locations.length` here.
  showLocationFilter?: boolean
  /** Render the search-and-sort strip at the top. */
  showSearch?: boolean
  /** Render the applied-filter chips at the bottom. */
  showChips?: boolean
  onChange: (partial: Partial<InboxState>) => void
  onClear: () => void
  className?: string
}) {
  const locationId = useId()
  // One location at a time in this control; the multi-select lives behind
  // "More filters", and the chip row shows when several are applied.
  const selectedLocation =
    locations.find((location) => location.id === state.locationIds[0]) ?? null
  const advancedCount = advancedFilterCount(state)

  // Start expanded when the URL already carries advanced filters (deep link /
  // restored state). Operators can collapse it; we do not auto-reopen on every
  // chip clear, which would fight intentional collapse.
  const [moreOpen, setMoreOpen] = useState(() => advancedFilterCount(state) > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {showSearch ? (
        <ReviewSearchBar state={state} onChange={onChange} />
      ) : null}

      <div className="flex flex-col gap-2">
        <ReplyFilter
          replyState={state.replyState}
          onChange={(replyState) => onChange({ replyState })}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <RatingFilter
            ratings={state.ratings}
            onChange={(ratings) => onChange({ ratings })}
          />
          <MoreFiltersToggle
            open={moreOpen}
            count={advancedCount}
            onOpenChange={setMoreOpen}
          />
        </div>
      </div>

      <div
        id="inbox-advanced-filters"
        className={cn(
          "grid transition-[grid-template-rows] duration-(--np-duration-standard) ease-spring",
          moreOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {moreOpen || advancedCount > 0 ? (
            <div
              className={cn(
                "pt-0.5 transition-opacity duration-(--np-duration-fast)",
                moreOpen ? "opacity-100" : "pointer-events-none opacity-0"
              )}
              inert={!moreOpen || undefined}
            >
              <AdvancedFilters state={state} onChange={onChange} />
            </div>
          ) : null}
        </div>
      </div>

      {/* Only the combobox is hidden for a single-location org — never the
          ActiveFilterChips below. A `?locationId=` can still arrive in the
          URL (components/home/attention-list.tsx links there unconditionally),
          and the chip's "Remove location filter" button is the only thing
          left that can clear it. Hiding the chip too would strand the user
          in a filtered view with no way out. */}
      {showLocationFilter ? (
        <div className="min-w-0">
          <label htmlFor={locationId} className="sr-only">
            Filter by location
          </label>
          <Combobox
            items={locations}
            value={selectedLocation}
            onValueChange={(location: LocationOption | null) =>
              onChange({ locationIds: location ? [location.id] : [] })
            }
            itemToStringLabel={(location: LocationOption) => location.name}
          >
            <ComboboxInput
              id={locationId}
              placeholder="All locations"
              aria-label="Filter by location"
            />
            <ComboboxContent>
              {locations.map((location) => (
                <ComboboxItem key={location.id} value={location}>
                  {location.name}
                </ComboboxItem>
              ))}
            </ComboboxContent>
          </Combobox>
        </div>
      ) : null}

      {showChips ? (
        <ActiveFilterChips
          state={state}
          locations={locations}
          onChange={onChange}
          onClear={onClear}
        />
      ) : null}
    </div>
  )
}

export { ReviewFilters, ReviewSearchBar }
