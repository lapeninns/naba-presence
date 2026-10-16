"use client"

import { useEffect, useState } from "react"

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
} from "@/lib/contracts/review-values"
import type { InboxState } from "@/lib/inbox/url-state"

// `<Select.Value>` resolves its displayed label from the root's `items` map
// (a plain `{ value: label }` record) rather than from the rendered
// `SelectItem` children — without it, the trigger would show the raw stored
// value ("updated_desc") instead of the sentence-case label. Both the map and
// the rendered items come from the contract's sort vocabulary.

/**
 * The review search's draft, debounced into the URL. The field itself is
 * the `Toolbar` primitive's (InboxToolbar draws it); this is what it types
 * into. The local draft follows the URL when it is cleared from elsewhere
 * ("Clear all filters", the search chip). The shell's ⌘K launcher is
 * Commands — clients, venues and actions — and deliberately does not look
 * inside review text, so this is the one place to type words a customer
 * wrote.
 *
 * `cancel` is the phone's "Cancel": it empties the draft and sends the same
 * `{ search: "" }` the debounce would, at once rather than 300ms later, so
 * the queues come back with the tap rather than after it.
 */
function useReviewSearch(
  state: InboxState,
  onChange: (partial: Partial<InboxState>) => void
) {
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

  function cancel() {
    setSearchDraft("")
    if (state.search !== "") onChange({ search: "" })
  }

  return { searchDraft, setSearchDraft, searchPending, cancel }
}

function ReviewSortSelect({
  state,
  onChange,
  className,
}: {
  state: InboxState
  onChange: (partial: Partial<InboxState>) => void
  className?: string
}) {
  return (
    <Select
      value={state.sort}
      onValueChange={(value: string | null) =>
        onChange({
          sort: value && isReviewSort(value) ? value : DEFAULT_REVIEW_SORT,
        })
      }
      items={REVIEW_SORT_LABELS}
    >
      <SelectTrigger aria-label="Sort reviews" className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent title="Sort reviews" alignItemWithTrigger={false}>
        {REVIEW_SORTS.map((sort) => (
          <SelectItem key={sort} value={sort}>
            {REVIEW_SORT_LABELS[sort]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export { ReviewSortSelect, useReviewSearch }
