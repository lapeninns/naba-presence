"use client"

import { useId } from "react"
import { ChevronDownIcon, StarIcon } from "lucide-react"

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
}: {
  legend: string
  options: readonly { value: string; label: string; ariaLabel?: string }[]
  selected: string[]
  onToggle: (value: string) => void
}) {
  return (
    <fieldset className="flex flex-col gap-0.5">
      <legend className="mb-1 text-caption font-medium text-muted-foreground">
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
            className={cn(
              "flex cursor-pointer items-center gap-2.5 rounded-(--nr-radius-control) px-2 py-1 transition-colors",
              checked ? "bg-accent/60" : "hover:bg-muted/50"
            )}
            onClick={() => onToggle(option.value)}
          >
            <Checkbox
              checked={checked}
              aria-label={option.ariaLabel ?? option.label}
              onClick={(event) => event.stopPropagation()}
              onCheckedChange={() => onToggle(option.value)}
            />
            <span aria-hidden="true" className="text-ui">
              {option.label}
            </span>
          </div>
        )
      })}
    </fieldset>
  )
}

/** Compact 1–5 star multi-select — always visible above the list. */
function RatingFilter({
  ratings,
  onChange,
}: {
  ratings: number[]
  onChange: (ratings: number[]) => void
}) {
  return (
    <div role="group" aria-label="Rating" className="grid grid-cols-5 gap-1">
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
              "flex h-8 items-center justify-center gap-1 rounded-(--nr-radius-control) border text-caption font-semibold tabular-nums transition-colors focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
              checked
                ? "border-primary/40 bg-accent text-foreground"
                : "border-border/70 bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            <StarIcon
              aria-hidden
              className={cn(
                "size-3",
                checked
                  ? "fill-(--rating) stroke-(--rating)"
                  : "fill-transparent stroke-current"
              )}
            />
            {option.value}
          </button>
        )
      })}
    </div>
  )
}

/** Any / Unreplied / Replied — always visible. */
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
      className="grid grid-cols-3 gap-1 rounded-(--nr-radius-control) border border-border/70 bg-muted/40 p-0.5"
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
              "rounded-[calc(var(--nr-radius-control)-2px)] px-1.5 py-1.5 text-center text-caption font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
              checked
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
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
 * Verification / publish / dates / sync — expands inline under the list
 * toolbar. No sheet or sidebar: filters stay next to the queue they affect.
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
    <div className="flex flex-col gap-4 rounded-(--nr-radius-field) border border-border/70 bg-card p-3">
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
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-caption font-medium text-muted-foreground">
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
              className="h-8 shadow-none"
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
              className="h-8 shadow-none"
            />
          </div>
        </div>
      </fieldset>
      <details className="group rounded-(--nr-radius-control) border border-border/60 open:bg-muted/20">
        <summary className="cursor-pointer list-none px-2.5 py-2 text-caption font-medium marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between gap-2">
            Sync status
            <span className="font-normal text-muted-foreground group-open:hidden">
              {state.syncStatus.length
                ? `${state.syncStatus.length} selected`
                : "Optional"}
            </span>
          </span>
        </summary>
        <div className="border-t border-border/50 px-1 pb-1.5">
          <CheckboxGroup
            legend="Sync status"
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
      variant={open || count > 0 ? "secondary" : "outline"}
      size="sm"
      aria-expanded={open}
      aria-controls="inbox-advanced-filters"
      className="w-full justify-between"
      onClick={() => onOpenChange(!open)}
    >
      <span className="inline-flex items-center gap-1.5">
        More filters
        {count > 0 ? (
          <span className="inline-flex min-w-4 items-center justify-center rounded-(--nr-radius-pill) bg-primary px-1.5 text-caption font-semibold text-primary-foreground tabular-nums">
            {count}
          </span>
        ) : null}
      </span>
      <ChevronDownIcon
        aria-hidden
        className={cn(
          "size-3.5 text-muted-foreground transition-transform",
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
