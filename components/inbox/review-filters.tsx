"use client"

import { useEffect, useId, useState } from "react"
import { Loader2Icon, SearchIcon } from "lucide-react"

import { ActiveFilterChips } from "@/components/inbox/active-filter-chips"
import {
  AdvancedFilters,
  MoreFiltersToggle,
  RatingFilter,
  ReplyFilter,
  advancedFilterCount,
} from "@/components/inbox/filter-controls"
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem } from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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

function ReviewFilters({
  state,
  locations,
  showLocationFilter = true,
  onChange,
  onClear,
}: {
  state: InboxState
  locations: LocationOption[]
  // Server-resolved; see the note on InboxView in inbox-view.tsx for why this
  // is not derived from `locations.length` here.
  showLocationFilter?: boolean
  onChange: (partial: Partial<InboxState>) => void
  onClear: () => void
}) {
  const searchId = useId()
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

  // Controlled + debounced search: local draft mirrors the URL's search, syncs
  // back when it is cleared externally ("Clear filters"/chip-clear), and writes
  // to the URL only after the user pauses typing.
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
    <div className="flex flex-col gap-2">
      {/* Search + sort share one strip; filters live on the rows below — no
          slide-over panel covering the detail pane. */}
      <div className="flex items-center gap-1.5 rounded-(--np-radius-field) border border-border/70 bg-muted/30 p-1">
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
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
            placeholder="Search reviewer or review text…"
            onChange={(event) => setSearchDraft(event.target.value)}
            className="h-8 border-transparent bg-transparent pr-8 pl-8 text-ui shadow-none focus-visible:bg-card focus-visible:ring-ring/20"
          />
          {searchPending ? (
            <Loader2Icon
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
            />
          ) : null}
        </div>

        <Select
          value={state.sort}
          onValueChange={(value: string | null) =>
            onChange({
              sort: value && isReviewSort(value) ? value : DEFAULT_REVIEW_SORT,
            })
          }
          items={REVIEW_SORT_LABELS}
        >
          <SelectTrigger
            aria-label="Sort reviews"
            className="h-8 w-auto shrink-0 border-transparent bg-transparent shadow-none hover:bg-card"
          >
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

      <div className="flex flex-wrap items-center gap-1.5">
        <RatingFilter
          ratings={state.ratings}
          onChange={(ratings) => onChange({ ratings })}
        />
        <ReplyFilter
          replyState={state.replyState}
          onChange={(replyState) => onChange({ replyState })}
        />
        <MoreFiltersToggle
          open={moreOpen}
          count={advancedCount}
          onOpenChange={setMoreOpen}
        />
      </div>

      <div
        id="inbox-advanced-filters"
        className={cn(
          "grid transition-[grid-template-rows] duration-(--np-duration-standard) ease-out",
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
            <ComboboxInput id={locationId} placeholder="All locations" aria-label="Filter by location" />
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

      <ActiveFilterChips
        state={state}
        locations={locations}
        onChange={onChange}
        onClear={onClear}
      />
    </div>
  )
}

export { ReviewFilters }
