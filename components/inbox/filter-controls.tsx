"use client"

import { useId } from "react"
import { ChevronDownIcon, SlidersHorizontalIcon, StarIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  PUBLISH_STATUS_OPTIONS,
  RATING_OPTIONS,
  SYNC_STATUS_OPTIONS,
  VERIFICATION_OPTIONS,
} from "@/lib/inbox/filter-labels"
import type { InboxState } from "@/lib/inbox/url-state"
import { cn } from "@/lib/utils"

function toggle(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value]
}

export function toggleRating(ratings: number[], value: number): number[] {
  return ratings.includes(value)
    ? ratings.filter((item) => item !== value)
    : [...ratings, value].sort((a, b) => b - a)
}

export function advancedFilterCount(state: InboxState): number {
  return (
    (state.verification.length ? 1 : 0) +
    (state.publishStatus.length ? 1 : 0) +
    (state.syncStatus.length ? 1 : 0) +
    (state.dateFrom || state.dateTo ? 1 : 0)
  )
}

function CheckboxGroup({
  legend,
  options,
  selected,
  onToggle,
  hideLegend = false,
}: {
  legend: string
  options: readonly { value: string; label: string; ariaLabel?: string }[]
  selected: string[]
  onToggle: (value: string) => void
  /** The legend stays for assistive tech when a visible heading already names the group. */
  hideLegend?: boolean
}) {
  return (
    <fieldset className="flex flex-col gap-0.5">
      <legend
        className={cn(
          "mb-1 px-2 text-caption font-medium text-ink-muted",
          hideLegend && "sr-only"
        )}
      >
        {legend}
      </legend>
      {options.map((option) => {
        const checked = selected.includes(option.value)
        // Do not wrap Base UI Checkbox in a native <label>: it auto-wires
        // aria-labelledby to the label text, which doubles aria-label into
        // names like "Failed Failed".
        return (
          <div
            key={option.value}
            className="flex h-8 cursor-pointer items-center gap-2.5 rounded-(--np-radius-control) px-2 transition-colors duration-(--np-duration-fast) hover:bg-(--np-hover-bg)"
            onClick={() => onToggle(option.value)}
          >
            <Checkbox
              checked={checked}
              aria-label={option.ariaLabel ?? option.label}
              onClick={(event) => event.stopPropagation()}
              onCheckedChange={() => onToggle(option.value)}
            />
            <span aria-hidden="true" className="text-ui text-ink">
              {option.label}
            </span>
          </div>
        )
      })}
    </fieldset>
  )
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

/**
 * Verification / publish / dates / sync — a white card that expands inline
 * under the toggle. No sheet or sidebar: filters stay next to the queue they
 * affect.
 */
function AdvancedFilters({
  state,
  onChange,
}: {
  state: InboxState
  onChange: (partial: Partial<InboxState>) => void
}) {
  const dateFromId = useId()
  const dateToId = useId()

  function toIso(dateValue: string): string | undefined {
    if (!dateValue) return undefined
    return new Date(`${dateValue}T00:00:00.000Z`).toISOString()
  }

  return (
    <div className="flex flex-col gap-4 rounded-(--np-radius-card) bg-surface p-2">
      <CheckboxGroup
        legend="Verification"
        options={VERIFICATION_OPTIONS}
        selected={state.verification}
        onToggle={(value) =>
          onChange({ verification: toggle(state.verification, value) })
        }
      />
      <CheckboxGroup
        legend="Publish status"
        options={PUBLISH_STATUS_OPTIONS}
        selected={state.publishStatus}
        onToggle={(value) =>
          onChange({ publishStatus: toggle(state.publishStatus, value) })
        }
      />
      <fieldset className="flex flex-col gap-1.5 px-2">
        <legend className="mb-1 text-caption font-medium text-ink-muted">
          Date range
        </legend>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={dateFromId} className="sr-only">
              From date
            </label>
            <Input
              id={dateFromId}
              type="date"
              aria-label="From date"
              value={state.dateFrom ? state.dateFrom.slice(0, 10) : ""}
              onChange={(event) =>
                onChange({ dateFrom: toIso(event.target.value) })
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={dateToId} className="sr-only">
              To date
            </label>
            <Input
              id={dateToId}
              type="date"
              aria-label="To date"
              value={state.dateTo ? state.dateTo.slice(0, 10) : ""}
              onChange={(event) =>
                onChange({ dateTo: toIso(event.target.value) })
              }
            />
          </div>
        </div>
      </fieldset>
      <details className="group flex flex-col">
        <summary className="flex h-8 cursor-pointer list-none items-center justify-between gap-2 rounded-(--np-radius-control) px-2 text-ui font-medium text-ink focus-halo transition-colors duration-(--np-duration-fast) select-none marker:content-none hover:bg-(--np-hover-bg) focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <span>Sync status</span>
          <span className="inline-flex items-center gap-1.5 text-caption font-normal text-ink-muted">
            <span className="group-open:hidden">
              {state.syncStatus.length
                ? `${state.syncStatus.length} selected`
                : "Optional"}
            </span>
            <ChevronDownIcon
              aria-hidden
              strokeWidth={1.75}
              className="size-3.5 transition-transform duration-(--np-duration-fast) ease-spring-snappy group-open:rotate-180"
            />
          </span>
        </summary>
        <div className="pt-1">
          <CheckboxGroup
            legend="Sync status"
            hideLegend
            options={SYNC_STATUS_OPTIONS}
            selected={state.syncStatus}
            onToggle={(value) =>
              onChange({ syncStatus: toggle(state.syncStatus, value) })
            }
          />
        </div>
      </details>
    </div>
  )
}

function MoreFiltersToggle({
  open,
  count,
  onOpenChange,
}: {
  open: boolean
  count: number
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Button
      type="button"
      variant={open || count > 0 ? "secondary" : "ghost"}
      size="sm"
      pill
      aria-expanded={open}
      aria-controls="inbox-advanced-filters"
      className="shrink-0"
      onClick={() => onOpenChange(!open)}
    >
      <SlidersHorizontalIcon
        aria-hidden
        strokeWidth={1.75}
        data-icon="inline-start"
        className="size-3.5 text-ink-muted"
      />
      More filters
      {count > 0 ? (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-(--np-radius-pill) bg-primary px-1 text-caption font-semibold text-primary-foreground tabular-nums">
          {count}
        </span>
      ) : null}
      <ChevronDownIcon
        aria-hidden
        strokeWidth={1.75}
        className={cn(
          "size-3.5 text-ink-muted transition-transform duration-(--np-duration-fast) ease-spring-snappy",
          open && "rotate-180"
        )}
      />
    </Button>
  )
}

export {
  AdvancedFilters,
  MoreFiltersToggle,
  RatingFilter,
  ReplyFilter,
}
