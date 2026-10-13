"use client"

import { StarIcon } from "lucide-react"

import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import {
  FILTER_NAMES,
  RATING_OPTIONS,
  REPLY_STATE_LABELS,
  WRITTEN_LABELS,
} from "@/lib/inbox/filter-labels"
import type { InboxState } from "@/lib/inbox/url-state"
import { cn } from "@/lib/utils"

export function toggleRating(ratings: number[], value: number): number[] {
  return ratings.includes(value)
    ? ratings.filter((item) => item !== value)
    : [...ratings, value].sort((a, b) => b - a)
}

/**
 * The 1–5 star multi-select, as one field-height control: a hairline box
 * holding five toggles, each a full 44px tall on touch (the box grows to
 * hold them) and the field height on a desk. A chosen rating fills with
 * ink, the way a pressed chip does — the accent is kept for the primary
 * action. The roles stay `checkbox`
 * because several can be on at once (Home deep-links `rating=1,2`).
 */
function RatingFilter({
  ratings,
  onChange,
  className,
}: {
  ratings: number[]
  onChange: (ratings: number[]) => void
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={FILTER_NAMES.rating}
      className={cn(
        "inline-flex h-12.5 shrink-0 items-center gap-0.5 rounded-(--np-radius-field) border border-line-strong bg-surface p-0.5 desk:h-(--np-field-h)",
        className
      )}
    >
      {RATING_OPTIONS.map((option) => {
        const checked = ratings.includes(option.value)
        return (
          <button
            key={option.value}
            type="button"
            role="checkbox"
            aria-checked={checked}
            aria-label={option.label}
            onClick={() => onChange(toggleRating(ratings, option.value))}
            className={cn(
              "inline-flex h-full min-w-8 flex-1 items-center justify-center gap-0.5 rounded-sm px-1.5 text-caption font-medium tabular-nums focus-halo transition-[background-color,color] duration-(--np-duration-fast) ease-spring-snappy select-none focus-visible:outline-none pointer-coarse:min-w-11",
              checked
                ? "bg-ink text-canvas"
                : "text-ink-secondary hover:bg-fill hover:text-ink"
            )}
          >
            <StarIcon
              aria-hidden
              strokeWidth={1.75}
              className={cn(
                "size-3",
                checked
                  ? "fill-current stroke-current"
                  : "fill-(--np-rating) stroke-(--np-rating)"
              )}
            />
            {option.value}
          </button>
        )
      })}
    </div>
  )
}

/** The "no narrowing" segment. Not `""`: an empty radio value reads as unset. */
const ANY = "any"

/**
 * "Any" plus a few values, as the filter sheet's reply and written-review
 * filters both need: the SegmentedControl as a radio group, because exactly
 * one is on and the person is choosing a value, not switching a view. The
 * primitive brings the roving tab stop, the arrow keys and the 44px touch
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

const REPLY_OPTIONS = [
  { value: "unreplied", label: REPLY_STATE_LABELS.unreplied },
  { value: "replied", label: REPLY_STATE_LABELS.replied },
] as const

function ReplyFilter({
  replyState,
  onChange,
}: {
  replyState: InboxState["replyState"]
  onChange: (replyState: InboxState["replyState"]) => void
}) {
  return (
    <SegmentedFilter
      label={FILTER_NAMES.replyState}
      value={replyState}
      options={REPLY_OPTIONS}
      onChange={onChange}
    />
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

export { RatingFilter, ReplyFilter, WrittenFilter }
