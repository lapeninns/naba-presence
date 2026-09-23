"use client"

import { useId, useState } from "react"

import { RatingFilter } from "@/components/inbox/filter-controls"
import { MoreFiltersPanel } from "@/components/inbox/more-filters"
import {
  ReviewSearchField,
  ReviewSortSelect,
} from "@/components/inbox/review-filters"
import type { LocationOption } from "@/components/inbox/active-filter-chips"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
} from "@/components/ui/combobox"
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
import { SlidersHorizontalIcon } from "lucide-react"
import { cn } from "@/lib/utils"

const ASSIGNEE_ITEMS: Record<string, string> = {
  "": "Anyone",
  me: "Me",
  unassigned: "Unassigned",
}

const AGE_ITEMS: Record<string, string> = {
  "": "Any age",
  ...REVIEW_AGE_LABELS,
}

const OWNER_ITEMS: Record<ApprovalOwner, string> = {
  anyone: "Anyone",
  me: "Me",
  others: "Others",
}

/** Everything that lives behind More filters, for the count on its button. */
export function moreFilterCount(state: InboxState): number {
  return (
    (state.clientId ? 1 : 0) +
    (state.replyState ? 1 : 0) +
    (state.dateFrom || state.dateTo ? 1 : 0)
  )
}

/**
 * A slot in the filter row. Each control keeps its name in words, but the
 * name is for assistive tech only (reference `.filters`): the row is a
 * single line of self-describing controls, and a caption over each one
 * doubled its height for words the control already shows.
 */
function Slot({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string
  htmlFor?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("flex min-w-0", className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="sr-only">
          {label}
        </label>
      ) : (
        <span className="sr-only">{label}</span>
      )}
      {children}
    </div>
  )
}

/**
 * Search · Venue · Rating · Assigned · Age · Sort · More filters — one row
 * above the panes that wraps rather than scrolls (reference `.filters`).
 *
 * The search leads and takes the room; the rest are what an operator changes
 * while working a queue. Client scope, reply status and custom dates live
 * behind More filters, which is a temporary sheet rather than a permanent
 * column: they are reached a few times a day. On a phone the search takes a
 * line of its own and the controls share the lines under it two by two.
 */
function FilterToolbar({
  state,
  locations,
  clients,
  showLocationFilter,
  onChange,
  onQueueChange,
  onClear,
}: {
  state: InboxState
  locations: LocationOption[]
  clients: { id: string; name: string }[]
  showLocationFilter: boolean
  onChange: (partial: Partial<InboxState>) => void
  onQueueChange: (queue: InboxState["queue"]) => void
  onClear: () => void
}) {
  const venueId = useId()
  const assigneeId = useId()
  const ageId = useId()
  const ownerId = useId()
  const [moreOpen, setMoreOpen] = useState(false)

  const selectedLocation =
    locations.find((location) => location.id === state.locationIds[0]) ?? null
  const isApproval = visibleQueue(state.queue) === "approval"
  const count = moreFilterCount(state)
  // Selects share a line two by two on a phone, and size to their words on
  // anything wider.
  const selectSlot = "max-sm:flex-[1_1_120px] sm:flex-[0_1_auto]"

  return (
    <div
      data-slot="inbox-filter-toolbar"
      role="group"
      aria-label="Filter reviews"
      className="flex min-w-0 flex-wrap items-center gap-2"
    >
      <ReviewSearchField
        state={state}
        onChange={onChange}
        className="max-w-[340px] flex-[1_1_220px] max-sm:max-w-none max-sm:basis-full"
      />

      {/* Only the control is hidden for a single-location org, never the chip
          that clears a stale `?locationId=` arriving from Home's attention
          list — hiding both strands the operator in a filtered view. */}
      {showLocationFilter ? (
        <Slot
          label="Venue"
          htmlFor={venueId}
          className="flex-[0_1_200px] max-sm:flex-[1_1_120px]"
        >
          <Combobox
            items={locations}
            value={selectedLocation}
            onValueChange={(location: LocationOption | null) =>
              onChange({ locationIds: location ? [location.id] : [] })
            }
            itemToStringLabel={(location: LocationOption) => location.name}
          >
            <ComboboxInput
              id={venueId}
              placeholder="All venues"
              aria-label="Filter by location"
            />
            <ComboboxContent>
              {locations.map((location) => (
                <ComboboxItem key={location.id} value={location}>
                  {location.name}
                </ComboboxItem>
              ))}
            </ComboboxContent>
          </Combobox>
        </Slot>
      ) : null}

      {/* Kept as five visible star toggles rather than folded into a select:
          rating is the filter operators reach for most, several can be on at
          once, and one click is worth more than the room a menu would save. */}
      <Slot label="Rating" className="max-sm:basis-full">
        <RatingFilter
          ratings={state.ratings}
          onChange={(ratings) => onChange({ ratings })}
          className="max-sm:w-full"
        />
      </Slot>

      <Slot label="Assigned" htmlFor={assigneeId} className={selectSlot}>
        <Select
          value={state.assignee ?? ""}
          items={ASSIGNEE_ITEMS}
          onValueChange={(value: string | null) =>
            onChange({ assignee: value ? value : undefined })
          }
        >
          <SelectTrigger
            id={assigneeId}
            aria-label="Filter by assignee"
            className="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {Object.entries(ASSIGNEE_ITEMS).map(([value, label]) => (
              <SelectItem key={value || "anyone"} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Slot>

      <Slot label="Age" htmlFor={ageId} className={selectSlot}>
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
            id={ageId}
            aria-label="Filter by review age"
            className="w-full"
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
      </Slot>

      {/* Only inside Approval, because it only means anything there. It writes
          the queue itself rather than a second parameter: `awaiting_my_approval`
          and `awaiting_others` already carry the exact ownership rule, so the
          control cannot drift from what the server decides. */}
      {isApproval ? (
        <Slot label="Waiting on" htmlFor={ownerId} className={selectSlot}>
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
              id={ownerId}
              aria-label="Approval waiting on"
              className="w-full"
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
        </Slot>
      ) : null}

      <Slot label="Sort" className={selectSlot}>
        <ReviewSortSelect
          state={state}
          onChange={onChange}
          className="w-full"
        />
      </Slot>

      <Button
        type="button"
        variant="secondary"
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen(true)}
        className="max-sm:flex-[1_1_120px]"
      >
        <SlidersHorizontalIcon aria-hidden data-icon="inline-start" />
        More filters
        {count > 0 ? (
          <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-(--np-radius-pill) bg-ink px-1 font-mono text-[11px] leading-none font-semibold text-canvas tabular-nums">
            {count}
          </span>
        ) : null}
      </Button>

      <MoreFiltersPanel
        open={moreOpen}
        onOpenChange={setMoreOpen}
        state={state}
        clients={clients}
        onChange={onChange}
        onClear={onClear}
      />
    </div>
  )
}

export { FilterToolbar }
