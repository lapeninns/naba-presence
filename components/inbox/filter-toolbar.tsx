"use client"

import { useId, useState } from "react"
import { SlidersHorizontalIcon } from "lucide-react"

import { FiltersSheet } from "@/components/inbox/more-filters"
import { ReviewSortSelect } from "@/components/inbox/review-filters"
import type { LocationOption } from "@/components/inbox/active-filter-chips"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
 * How many narrowings are on, for the count on the Filters button. Search is
 * in the toolbar where it can be read, sort only orders the rows, and the
 * approval owner is a queue, so none of those count.
 */
export function activeFilterCount(state: InboxState): number {
  return (
    (state.ratings.length > 0 ? 1 : 0) +
    (state.locationIds.length > 0 ? 1 : 0) +
    (state.assignee ? 1 : 0) +
    (state.age ? 1 : 0) +
    (state.clientId ? 1 : 0) +
    (state.replyState ? 1 : 0) +
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
      <SelectContent alignItemWithTrigger={false}>
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
      <SelectContent alignItemWithTrigger={false}>
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
 * The filter end of the toolbar's second row (reference `.filters`): as few
 * controls as the width allows, and everything behind one Filters sheet.
 *
 * - 1280px and up: age, "waiting on" (Approval only) and sort stay on
 *   screen beside the button. Rating is in the sheet, where its five
 *   toggles have room, and its chip shows above the list once it is on.
 * - 1024 to 1279: sort and the button.
 * - 768 to 1023: the button alone; beside the icon rail and the queue track
 *   a sort select has no room to say what it sorts by.
 * - Phones: the button alone, so the queue track keeps the room.
 *
 * The sheet always holds every control, so nothing is out of reach at any
 * width; the inline copies are shortcuts to the ones used most.
 */
function FilterToolbar({
  state,
  locations,
  clients,
  showLocationFilter,
  onChange,
  onQueueChange,
  onClear,
  className,
}: {
  state: InboxState
  locations: LocationOption[]
  clients: { id: string; name: string }[]
  showLocationFilter: boolean
  onChange: (partial: Partial<InboxState>) => void
  onQueueChange: (queue: InboxState["queue"]) => void
  onClear: () => void
  className?: string
}) {
  const ageId = useId()
  const ownerId = useId()
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
      <label htmlFor={ageId} className="sr-only">
        Age
      </label>
      <AgeSelect
        id={ageId}
        state={state}
        onChange={onChange}
        className="w-auto shrink-0 max-xl:hidden"
      />

      {isApproval ? (
        <>
          <label htmlFor={ownerId} className="sr-only">
            Waiting on
          </label>
          <OwnerSelect
            id={ownerId}
            state={state}
            onQueueChange={onQueueChange}
            className="w-auto shrink-0 max-xl:hidden"
          />
        </>
      ) : null}

      <ReviewSortSelect
        state={state}
        onChange={onChange}
        className="w-auto shrink-0 max-lg:hidden"
      />

      <Button
        type="button"
        variant="secondary"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={count > 0 ? `Filters, ${count} active` : "Filters"}
        onClick={() => setOpen(true)}
        className="shrink-0"
      >
        <SlidersHorizontalIcon aria-hidden data-icon="inline-start" />
        Filters
        {count > 0 ? (
          <span
            aria-hidden
            className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-(--np-radius-pill) bg-ink px-1 font-mono text-[11px] leading-none font-semibold text-canvas tabular-nums"
          >
            {count}
          </span>
        ) : null}
      </Button>

      <FiltersSheet
        open={open}
        onOpenChange={setOpen}
        state={state}
        locations={locations}
        clients={clients}
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
