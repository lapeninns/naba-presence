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
 * Compact 1–5 star multi-select. Capsule chips on the fill grey; a chosen
 * rating fills with the accent, the same way a pressed ToggleChip does. The
 * roles stay `checkbox` because several can be on at once.
 */
function RatingFilter({
  ratings,
  onChange,
}: {
  ratings: number[]
  onChange: (ratings: number[]) => void
}) {
  return (
    <div
      role="group"
      aria-label="Rating"
      className="flex shrink-0 flex-wrap items-center gap-1"
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
              "inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-0.5 rounded-(--np-radius-pill) px-2 text-caption font-medium tabular-nums focus-halo transition duration-(--np-duration-fast) ease-spring-snappy select-none focus-visible:outline-none active:scale-[0.98]",
              checked
                ? "bg-primary text-primary-foreground hover:bg-(--np-accent-hover)"
                : "bg-fill text-ink hover:bg-fill-secondary"
            )}
          >
            <StarIcon
              aria-hidden
              strokeWidth={1.75}
              className={cn(
                "size-3",
                checked ? "fill-current stroke-current" : "fill-transparent stroke-current"
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
