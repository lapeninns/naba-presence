"use client"

import { useId, useState } from "react"

import { RatingFilter } from "@/components/inbox/filter-controls"
import { MoreFiltersPanel } from "@/components/inbox/more-filters"
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
 * A labelled slot in the toolbar: the caption over the control.
 *
 * A `<label>` only when there is a control for it to name. The Rating slot
 * holds five star checkboxes, each already labelled — a `<label>` with no
 * `for` there is an element that names nothing, and clicking it does nothing
 * either, so that slot gets a caption instead. `text-caption` already carries
 * its own line height (the `--leading-caption` token this used to name does
 * not exist, so that utility resolved to nothing).
 */
const SLOT_LABEL_CLASS = "px-1 text-caption text-ink-muted"

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
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className={SLOT_LABEL_CLASS}>
          {label}
        </label>
      ) : (
        <span className={SLOT_LABEL_CLASS}>{label}</span>
      )}
      {children}
    </div>
  )
}

/**
 * Venue · Rating · Assigned · Age · More filters — one line above the panes.
 *
 * The four on the left are what an operator changes while working a queue. The
 * rest (client scope, reply status, custom dates) live behind More filters,
 * which is a temporary panel rather than a permanent column: they are reached a
 * few times a day, and the width they used to occupy is worth more to the reply.
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

  return (
    <div
      data-slot="inbox-filter-toolbar"
      role="group"
      aria-label="Filter reviews"
      className="flex min-w-0 flex-wrap items-end gap-2"
    >
      {/* Only the control is hidden for a single-location org, never the chip
          that clears a stale `?locationId=` arriving from Home's attention
          list — hiding both strands the operator in a filtered view. */}
      {showLocationFilter ? (
        <Slot
          label="Venue"
          htmlFor={venueId}
          className="basis-54 max-xl:basis-48 max-md:flex-1 max-md:basis-auto"
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

      {/* Kept as five visible star checkboxes rather than folded into a select:
          rating is the filter operators reach for most, and one click is worth
          more than the 90px a menu would save. */}
      <Slot label="Rating">
        <div className="flex h-(--np-control-h) items-center">
          <RatingFilter
            ratings={state.ratings}
            onChange={(ratings) => onChange({ ratings })}
          />
        </div>
      </Slot>

      <Slot label="Assigned" htmlFor={assigneeId} className="basis-32">
        <Select
          value={state.assignee ?? ""}
          items={ASSIGNEE_ITEMS}
          onValueChange={(value: string | null) =>
            onChange({ assignee: value ? value : undefined })
          }
        >
          <SelectTrigger id={assigneeId} aria-label="Filter by assignee">
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

      <Slot label="Age" htmlFor={ageId} className="basis-36">
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
          <SelectTrigger id={ageId} aria-label="Filter by review age">
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
        <Slot label="Waiting on" htmlFor={ownerId} className="basis-32">
          <Select
            value={approvalOwner(state.queue)}
            items={OWNER_ITEMS}
            onValueChange={(value: string | null) =>
              onQueueChange(
                queueForApprovalOwner((value ?? "anyone") as ApprovalOwner)
              )
            }
          >
            <SelectTrigger id={ownerId} aria-label="Approval waiting on">
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

      <div className="ml-auto flex items-center gap-1 self-end max-xl:ml-0 max-md:w-full max-md:justify-end">
        <Button
          type="button"
          variant={count > 0 ? "secondary" : "ghost"}
          size="sm"
          pill
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
        >
          <SlidersHorizontalIcon
            aria-hidden
            strokeWidth={1.75}
            data-icon="inline-start"
            className="size-3.5 text-ink-muted"
          />
          More filters
          {count > 0 ? (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-(--np-radius-pill) bg-fill px-1 text-caption font-semibold text-ink tabular-nums">
              {count}
            </span>
          ) : null}
        </Button>
      </div>

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
