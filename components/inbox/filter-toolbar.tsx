"use client"

import { useState } from "react"

import { FiltersSheet } from "@/components/inbox/more-filters"
import type { LocationOption } from "@/components/inbox/active-filter-chips"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FilterButton } from "@/components/ui/toolbar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { REVIEW_AGE_LABELS, isReviewAge } from "@/lib/inbox/review-age"
import {
  approvalOwner,
  queueForApprovalOwner,
  visibleQueue,
  type ApprovalOwner,
  type InboxState,
} from "@/lib/inbox/url-state"
import { cn } from "@/lib/utils"

const AGE_ITEMS: Record<string, string> = {
  "": "Any age",
  ...REVIEW_AGE_LABELS,
}

const OWNER_ITEMS: Record<ApprovalOwner, string> = {
  anyone: "Anyone",
  me: "Me",
  others: "Others",
}

/**
 * How many of the narrowings in the Filters sheet are on, for the count on
 * the Filters button. Rating and "With text" are chips of their own above the
 * list, search is in the toolbar where it can be read, sort only orders the
 * rows, and the approval owner is a queue, so none of those count.
 */
export function activeFilterCount(state: InboxState): number {
  return (
    (state.written === "rating_only" ? 1 : 0) +
    (state.topic ? 1 : 0) +
    (state.locationIds.length > 0 ? 1 : 0) +
    (state.assignee ? 1 : 0) +
    (state.age ? 1 : 0) +
    (state.dateFrom || state.dateTo ? 1 : 0)
  )
}

/** The age preset select, shared by the toolbar and the Filters sheet. */
function AgeSelect({
  state,
  onChange,
  id,
  className,
}: {
  state: InboxState
  onChange: (partial: Partial<InboxState>) => void
  id?: string
  className?: string
}) {
  return (
    <Select
      value={state.age ?? ""}
      items={AGE_ITEMS}
      onValueChange={(value: string | null) =>
        // Choosing a preset clears any custom range, so the two controls
        // can never narrow the same columns in contradiction of each other
        // (lib/inbox/review-age.ts).
        onChange({
          age: isReviewAge(value) ? value : undefined,
          dateFrom: undefined,
          dateTo: undefined,
        })
      }
    >
      <SelectTrigger
        id={id}
        aria-label="Filter by review age"
        className={className}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent title="Review age" alignItemWithTrigger={false}>
        {Object.entries(AGE_ITEMS).map(([value, label]) => (
          <SelectItem key={value || "any"} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Who an approval is waiting on. Only inside Approval, because it only means
 * anything there. It writes the queue itself rather than a second parameter:
 * `awaiting_my_approval` and `awaiting_others` already carry the exact
 * ownership rule, so the control cannot drift from what the server decides.
 */
function OwnerSelect({
  state,
  onQueueChange,
  id,
  className,
}: {
  state: InboxState
  onQueueChange: (queue: InboxState["queue"]) => void
  id?: string
  className?: string
}) {
  return (
    <Select
      value={approvalOwner(state.queue)}
      items={OWNER_ITEMS}
      onValueChange={(value: string | null) =>
        onQueueChange(
          queueForApprovalOwner((value ?? "anyone") as ApprovalOwner)
        )
      }
    >
      <SelectTrigger
        id={id}
        aria-label="Approval waiting on"
        className={className}
      >
        <span className="text-ink-muted">Waiting on:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent title="Approval waiting on" alignItemWithTrigger={false}>
        {Object.entries(OWNER_ITEMS).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * The filter end of the toolbar (reference `.filters`), in the `Toolbar`
 * primitive's filter slot beside the search: as few controls as the width
 * allows, and everything behind one Filters sheet.
 *
 * - `xl` and up: "waiting on" (Approval only) stays on screen beside the
 *   button.
 * - Below `xl`: the button alone; beside a narrow search a select has no
 *   room to say what it sets.
 *
 * Age and sort live only in the sheet (they used to be mounted a second time
 * here, hidden at every width). Rating and "With text" are chips above the
 * list at every width, so they are not here or in the sheet.
 */
function FilterToolbar({
  state,
  locations,
  showLocationFilter,
  onChange,
  onQueueChange,
  onClear,
  resultLabel,
  className,
}: {
  state: InboxState
  /** The list's count label, for the sheet's "Show 12 reviews". */
  resultLabel: string
  locations: LocationOption[]
  showLocationFilter: boolean
  onChange: (partial: Partial<InboxState>) => void
  onQueueChange: (queue: InboxState["queue"]) => void
  onClear: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const isApproval = visibleQueue(state.queue) === "approval"
  const count = activeFilterCount(state)

  return (
    <div
      data-slot="inbox-filter-toolbar"
      role="group"
      aria-label="Filter reviews"
      className={cn("flex min-w-0 items-center justify-end gap-2", className)}
    >
      {isApproval ? (
        <OwnerSelect
          state={state}
          onQueueChange={onQueueChange}
          className="w-auto shrink-0 max-xl:hidden"
        />
      ) : null}

      {/* The Toolbar's Filter button (Notion Mail's circle): 44px on
          touch, the control height at the desk. Its name says how many are
          on ("Filters, 2 active"); while any is, the icon takes the accent
          ink and the count badge rides its corner. The word is not drawn, so
          a desk pointer gets it as a tooltip (never on touch, and never the
          name: the button carries its own). */}
      <Tooltip>
        <TooltipTrigger
          render={
            <FilterButton
              count={count}
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            />
          }
        />
        <TooltipContent>Filters</TooltipContent>
      </Tooltip>

      <FiltersSheet
        open={open}
        onOpenChange={setOpen}
        resultLabel={resultLabel}
        state={state}
        locations={locations}
        showLocationFilter={showLocationFilter}
        onChange={onChange}
        onClear={onClear}
        ageControl={(id) => (
          <AgeSelect
            id={id}
            state={state}
            onChange={onChange}
            className="w-full"
          />
        )}
        ownerControl={
          isApproval
            ? (id) => (
                <OwnerSelect
                  id={id}
                  state={state}
                  onQueueChange={onQueueChange}
                  className="w-full"
                />
              )
            : undefined
        }
      />
    </div>
  )
}

export { FilterToolbar }
