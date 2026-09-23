"use client"

import { useEffect, useId, useState } from "react"

import { cn } from "@/lib/utils"

import { SearchInput } from "@/components/ui/input"
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
 * The review search: one field, debounced into the URL. The local draft
 * follows the URL when it is cleared from elsewhere ("Clear filters", the
 * chip's remove button). The shell's ⌘K launcher is Commands — clients,
 * venues and actions — and deliberately does not look inside review text, so
 * this is the one place to type words a customer wrote.
 */
function ReviewSearchField({
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
    <>
      <label htmlFor={searchId} className="sr-only">
        Search reviews
      </label>
      <SearchInput
        id={searchId}
        role="searchbox"
        aria-label="Search reviews"
        aria-busy={searchPending || undefined}
        value={searchDraft}
        placeholder="Search review text or reviewer"
        onChange={(event) => setSearchDraft(event.target.value)}
        className={className}
      />
    </>
  )
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
      <SelectContent alignItemWithTrigger={false}>
        {REVIEW_SORTS.map((sort) => (
          <SelectItem key={sort} value={sort}>
            {REVIEW_SORT_LABELS[sort]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Search and sort side by side, for a surface that wants them as one strip. */
function ReviewSearchBar({
  state,
  onChange,
  className,
}: {
  state: InboxState
  onChange: (partial: Partial<InboxState>) => void
  className?: string
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <ReviewSearchField state={state} onChange={onChange} className="flex-1" />
      <ReviewSortSelect
        state={state}
        onChange={onChange}
        className="shrink-0"
      />
    </div>
  )
}

export { ReviewSearchBar, ReviewSearchField, ReviewSortSelect }
