"use client"

import { useEffect, useId, useState } from "react"
import { SearchIcon } from "lucide-react"

import { ActiveFilterChips } from "@/components/inbox/active-filter-chips"
import { MoreFiltersSheet } from "@/components/inbox/more-filters-sheet"
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem } from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { LocationEntry } from "@/lib/api/locations"
import type { InboxState } from "@/lib/inbox/url-state"

// `<Select.Value>` resolves its displayed label from the root's `items` map
// (a plain `{ value: label }` record) rather than from the rendered
// `SelectItem` children — without it, the trigger would show the raw stored
// value ("all", "updated_desc") instead of the sentence-case label.
const RATING_ITEMS: Record<string, string> = {
  all: "All ratings",
  "5": "5 stars",
  "4": "4 stars",
  "3": "3 stars",
  "2": "2 stars",
  "1": "1 star",
}

const SORT_ITEMS: Record<string, string> = {
  updated_desc: "Most recent",
  rating_desc: "Highest rated",
  rating_asc: "Lowest rated",
}

function ReviewFilters({
  state,
  locations,
  onChange,
  onClear,
}: {
  state: InboxState
  locations: LocationEntry[]
  onChange: (partial: Partial<InboxState>) => void
  onClear: () => void
}) {
  const searchId = useId()
  const locationId = useId()
  const selectedLocation =
    locations.find((location) => location.id === state.locationId) ?? null

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

  return (
    <div className="flex flex-col gap-3">
      {/* Search leads: it is the highest-frequency refinement in a queue
          workflow, so it takes the full row; pickers line up beneath. */}
      <div className="relative">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <label htmlFor={searchId} className="sr-only">
          Search reviews
        </label>
        <Input
          id={searchId}
          type="search"
          role="searchbox"
          aria-label="Search reviews"
          value={searchDraft}
          placeholder="Search review text, reviewer, location…"
          onChange={(event) => setSearchDraft(event.target.value)}
          className="h-8 pl-9 text-ui shadow-none"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-44 flex-1">
          <label htmlFor={locationId} className="sr-only">
            Filter by location
          </label>
          <Combobox
            items={locations}
            value={selectedLocation}
            onValueChange={(location: LocationEntry | null) =>
              onChange({ locationId: location?.id })
            }
            itemToStringLabel={(location: LocationEntry) => location.name}
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

        <Select
          value={state.ratings.length === 1 ? String(state.ratings[0]) : "all"}
          onValueChange={(value: string | null) =>
            onChange({ ratings: !value || value === "all" ? [] : [Number(value)] })
          }
          items={RATING_ITEMS}
        >
          <SelectTrigger aria-label="Filter by rating" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ratings</SelectItem>
            {[5, 4, 3, 2, 1].map((rating) => (
              <SelectItem key={rating} value={String(rating)}>
                {rating} star{rating === 1 ? "" : "s"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={state.sort}
          onValueChange={(value: string | null) =>
            onChange({ sort: (value ?? "updated_desc") as InboxState["sort"] })
          }
          items={SORT_ITEMS}
        >
          <SelectTrigger aria-label="Sort reviews" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated_desc">Most recent</SelectItem>
            <SelectItem value="rating_desc">Highest rated</SelectItem>
            <SelectItem value="rating_asc">Lowest rated</SelectItem>
          </SelectContent>
        </Select>

        <MoreFiltersSheet state={state} onChange={onChange} />
      </div>

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
