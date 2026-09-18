"use client"

import { useEffect, useId, useState } from "react"

import { cn } from "@/lib/utils"

import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DEFAULT_REVIEW_SORT,
  REVIEW_SORT_LABELS,
  REVIEW_SORTS,
  isReviewSort,
} from "@/lib/contracts/reviews"
import type { InboxState } from "@/lib/inbox/url-state"

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

export { ReviewSearchBar }
