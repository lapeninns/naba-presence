"use client"

import { StarIcon } from "lucide-react"

import { RATING_OPTIONS } from "@/lib/inbox/filter-labels"
import type { InboxState } from "@/lib/inbox/url-state"
import { cn } from "@/lib/utils"

export function toggleRating(ratings: number[], value: number): number[] {
  return ratings.includes(value)
    ? ratings.filter((item) => item !== value)
    : [...ratings, value].sort((a, b) => b - a)
}

/**
 * The 1–5 star multi-select, as one 36px control: a hairline box holding
 * five toggles. A chosen rating fills with ink, the way a pressed chip does —
 * the accent is kept for the primary action. The roles stay `checkbox`
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
      aria-label="Rating"
      className={cn(
        "inline-flex h-(--np-field-h) shrink-0 items-center gap-0.5 rounded-(--np-radius-field) border border-line-strong bg-surface p-0.5",
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
              "inline-flex h-full min-w-8 flex-1 items-center justify-center gap-0.5 rounded-[6px] px-1.5 font-mono text-caption font-medium tabular-nums focus-halo transition-[background-color,color] duration-(--np-duration-fast) ease-spring-snappy select-none focus-visible:outline-none pointer-coarse:min-w-10",
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

/**
 * Any / Unreplied / Replied. Drawn as a segmented control — a fill-grey track
 * with a white, raised thumb on the chosen segment — but kept as a radio
 * group, because exactly one is on and that is what a radio says.
 */
function ReplyFilter({
  replyState,
  onChange,
}: {
  replyState: InboxState["replyState"]
  onChange: (replyState: InboxState["replyState"]) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Reply state"
      className="inline-flex h-7 w-full shrink-0 items-center gap-0.5 rounded-(--np-radius-control) bg-fill p-0.5"
    >
      {(
        [
          { value: "", label: "Any" },
          { value: "unreplied", label: "Unreplied" },
          { value: "replied", label: "Replied" },
        ] as const
      ).map((option) => {
        const checked = (replyState ?? "") === option.value
        return (
          <button
            key={option.value || "any"}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.label}
            onClick={() =>
              onChange(
                option.value === ""
                  ? undefined
                  : (option.value as "replied" | "unreplied")
              )
            }
            className={cn(
              "h-full min-w-0 flex-1 rounded-[calc(var(--np-radius-control)-2px)] px-2 text-center text-ui font-medium whitespace-nowrap focus-halo transition duration-(--np-duration-fast) ease-spring-snappy select-none focus-visible:outline-none active:scale-[0.98]",
              checked
                ? "bg-surface text-ink shadow-(--np-shadow-raised)"
                : "text-ink-muted hover:text-ink"
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export { RatingFilter, ReplyFilter }
