"use client"

import { StarIcon } from "lucide-react"

import { ChipRow, FilterChip } from "@/components/ui/chip"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import {
  FILTER_NAMES,
  RATING_OPTIONS,
  WRITTEN_LABELS,
} from "@/lib/inbox/filter-labels"
import type { InboxState } from "@/lib/inbox/url-state"

export function toggleRating(ratings: number[], value: number): number[] {
  return ratings.includes(value)
    ? ratings.filter((item) => item !== value)
    : [...ratings, value].sort((a, b) => b - a)
}

/**
 * The two commonest narrowings as one-tap chips above the list: each star
 * rating (several may be on, as Home's `rating=1,2` deep link needs) and
 * "With text". They are the toolbar's own copy of those two filters, so the
 * sheet does not repeat the ratings; 5 stars with text is two taps. A
 * pressed chip is the primitive's accent-tint toggle, announced through
 * `aria-pressed`. The strip scrolls sideways rather than wrapping or
 * clipping a label.
 */
function QuickFilters({
  ratings,
  written,
  onChange,
  className,
}: {
  ratings: number[]
  written: InboxState["written"]
  onChange: (partial: Partial<InboxState>) => void
  className?: string
}) {
  return (
    <ChipRow
      role="group"
      aria-label="Quick filters"
      data-slot="inbox-quick-filters"
      className={className}
    >
      {RATING_OPTIONS.map((option) => (
        <FilterChip
          key={option.value}
          pressed={ratings.includes(option.value)}
          aria-label={option.label}
          onClick={() =>
            onChange({ ratings: toggleRating(ratings, option.value) })
          }
        >
          <StarIcon
            aria-hidden
            strokeWidth={1.75}
            className="fill-(--np-rating) stroke-(--np-rating)"
          />
          {option.value}
        </FilterChip>
      ))}
      <FilterChip
        pressed={written === "with_text"}
        onClick={() =>
          onChange({
            written: written === "with_text" ? undefined : "with_text",
          })
        }
      >
        {WRITTEN_LABELS.with_text}
      </FilterChip>
    </ChipRow>
  )
}

/** The "no narrowing" segment. Not `""`: an empty radio value reads as unset. */
const ANY = "any"

/**
 * "Any" plus a few values, as the filter sheet's written-review filter
 * needs: the SegmentedControl as a radio group, because exactly one is on
 * and the person is choosing a value, not switching a view. The primitive
 * brings the roving tab stop, the arrow keys and the 44px touch
 * track; this only maps "Any" to an unset filter.
 */
function SegmentedFilter<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T | undefined
  options: readonly { value: T; label: string }[]
  onChange: (value: T | undefined) => void
}) {
  return (
    <SegmentedControl
      semantics="radio"
      aria-label={label}
      value={value ?? ANY}
      onValueChange={(next) => onChange(next === ANY ? undefined : (next as T))}
      className="w-full"
    >
      <SegmentedControlItem value={ANY}>Any</SegmentedControlItem>
      {options.map((option) => (
        <SegmentedControlItem key={option.value} value={option.value}>
          {option.label}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  )
}

export const WRITTEN_OPTIONS = [
  { value: "with_text", label: WRITTEN_LABELS.with_text },
  { value: "rating_only", label: WRITTEN_LABELS.rating_only },
] as const

function WrittenFilter({
  written,
  onChange,
}: {
  written: InboxState["written"]
  onChange: (written: InboxState["written"]) => void
}) {
  return (
    <SegmentedFilter
      label={FILTER_NAMES.written}
      value={written}
      options={WRITTEN_OPTIONS}
      onChange={onChange}
    />
  )
}

export { QuickFilters, WrittenFilter }
