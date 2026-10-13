"use client"

import { useEffect, useId, useRef, useState } from "react"

import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
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
 * The review search, and the inbox's only one at every width ("Search
 * reviews" is its name, label and placeholder): one field, debounced into
 * the URL. The local draft
 * follows the URL when it is cleared from elsewhere ("Clear all filters",
 * the search chip). The shell's ⌘K launcher is Commands — clients,
 * venues and actions — and deliberately does not look inside review text, so
 * this is the one place to type words a customer wrote.
 *
 * Drawn as Notion Mail's search pill: the field fill, no edge until focus,
 * a leading magnifier and the clear control. On a phone in search mode the
 * toolbar asks for a "Cancel" beside it (`showCancel`): it empties the
 * draft and sends the same `{ search: "" }` the debounce would (at once, not
 * 300ms later), takes the caret out, and tells the toolbar to unfold
 * (`onCancel`).
 */
function ReviewSearchField({
  ref,
  state,
  onChange,
  showShortcut = false,
  showCancel = false,
  onFocus,
  onCancel,
  className,
}: {
  /** The input itself, so the `/` shortcut can put the caret in it. */
  ref?: React.Ref<HTMLInputElement>
  state: InboxState
  onChange: (partial: Partial<InboxState>) => void
  /**
   * Draws the `/` key hint at the trailing edge while the field is empty —
   * on a desk only, since a phone has no key to press.
   */
  showShortcut?: boolean
  /** The phone's "Cancel" beside the field (hidden from `md`). */
  showCancel?: boolean
  onFocus?: () => void
  onCancel?: () => void
  className?: string
}) {
  const searchId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
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

  const setRefs = (node: HTMLInputElement | null) => {
    inputRef.current = node
    if (typeof ref === "function") ref(node)
    else if (ref) ref.current = node
  }

  function cancel() {
    setSearchDraft("")
    // What the debounce would send 300ms later, sent now, so the strip
    // comes back with the tap rather than after it.
    if (state.search !== "") onChange({ search: "" })
    inputRef.current?.blur()
    onCancel?.()
  }

  return (
    <div className={cn("relative flex min-w-0 items-center gap-1", className)}>
      <label htmlFor={searchId} className="sr-only">
        Search reviews
      </label>
      <SearchInput
        ref={setRefs}
        id={searchId}
        role="searchbox"
        aria-label="Search reviews"
        aria-busy={searchPending || undefined}
        value={searchDraft}
        placeholder="Search reviews"
        enterKeyHint="search"
        onChange={(event) => setSearchDraft(event.target.value)}
        onFocus={onFocus}
        className="w-full rounded-(--np-radius-pill) border-transparent bg-fill-secondary pl-3"
        inputClassName={showShortcut ? "desk:pr-7" : undefined}
      />
      {showShortcut && searchDraft === "" ? (
        <Kbd
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 desk:inline-flex"
        >
          /
        </Kbd>
      ) : null}
      {showCancel ? (
        <Button
          type="button"
          variant="ghost"
          onClick={cancel}
          className="h-(--np-touch) shrink-0 px-2 md:hidden"
        >
          Cancel
        </Button>
      ) : null}
    </div>
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

export { ReviewSearchField, ReviewSortSelect }
