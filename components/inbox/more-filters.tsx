"use client"

import { useId } from "react"

import type { LocationOption } from "@/components/inbox/active-filter-chips"
import {
  RatingFilter,
  ReplyFilter,
  WrittenFilter,
} from "@/components/inbox/filter-controls"
import { ReviewSortSelect } from "@/components/inbox/review-filters"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
} from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { InboxState } from "@/lib/inbox/url-state"
import { cn } from "@/lib/utils"

function Group({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "flex flex-col gap-3 border-t border-line-subtle py-4 first:border-t-0 first:pt-0",
        className
      )}
    >
      <h3 className="text-ui font-semibold text-ink">{title}</h3>
      {children}
    </section>
  )
}

const ASSIGNEE_ITEMS: Record<string, string> = {
  "": "Anyone",
  me: "Me",
  unassigned: "Unassigned",
}

/**
 * Every narrowing the inbox offers, in one sheet (reference `#filters`): a
 * side sheet from 768px and a bottom sheet on a phone, which the Sheet
 * primitive decides on its own.
 *
 * The toolbar keeps a few of these on screen where the width allows (see
 * FilterToolbar); the sheet holds all of them at every width, so a phone
 * loses nothing. Changes apply as they are made, and the footer closes the
 * sheet on the result. The pipeline-state checkboxes and saved presets an
 * older panel carried are gone: they filtered on an engineer's view of a
 * record, not a question an operator asks.
 */
function FiltersSheet({
  open,
  onOpenChange,
  state,
  locations,
  clients,
  showLocationFilter,
  onChange,
  onClear,
  ageControl,
  ownerControl,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: InboxState
  locations: LocationOption[]
  /** The agency's clients, for the scope select. Empty for a single-client org. */
  clients: { id: string; name: string }[]
  /** False for a single-location org, which has no venue to choose. */
  showLocationFilter: boolean
  onChange: (partial: Partial<InboxState>) => void
  onClear: () => void
  /** The age select, drawn by the toolbar so both copies stay identical. */
  ageControl: (id: string) => React.ReactNode
  /** "Waiting on", inside Approval only. */
  ownerControl?: (id: string) => React.ReactNode
}) {
  const dateFromId = useId()
  const dateToId = useId()
  const clientId = useId()
  const venueId = useId()
  const assigneeId = useId()
  const ageId = useId()
  const ownerId = useId()
  const clientItems: Record<string, string> = {
    "": "All clients",
    ...Object.fromEntries(clients.map((client) => [client.id, client.name])),
  }
  const selectedLocation =
    locations.find((location) => location.id === state.locationIds[0]) ?? null

  function toIso(dateValue: string): string | undefined {
    if (!dateValue) return undefined
    return new Date(`${dateValue}T00:00:00.000Z`).toISOString()
  }

  // A typed date is the specific claim, so it clears the Age preset — the
  // mirror of what the Age control does to the dates. See lib/inbox/review-age.ts.
  function setDate(partial: Partial<InboxState>) {
    onChange({ ...partial, age: undefined })
  }

  const rangeInverted = Boolean(
    state.dateFrom && state.dateTo && state.dateFrom > state.dateTo
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="md:max-w-md">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>
            Narrow the queue. Changes apply as you make them.
          </SheetDescription>
        </SheetHeader>

        {/* `px-6` is the sheet gutter SheetHeader draws and every other sheet
            in the app carries. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6">
          <Group title="Rating">
            <RatingFilter
              ratings={state.ratings}
              onChange={(ratings) => onChange({ ratings })}
              className="h-11 w-full"
            />
          </Group>

          {/* Stars with no words are replied to from a standard template, a
              whole selection at a time — this is how to gather them. */}
          <Group title="Written review">
            <WrittenFilter
              written={state.written}
              onChange={(written) => onChange({ written })}
            />
          </Group>

          {/* Only the control is hidden for a single-location org, never the
              chip that clears a stale `?locationId=` arriving from a deep
              link — hiding both strands the operator in a filtered view. */}
          {showLocationFilter ? (
            <Group title="Venue">
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
            </Group>
          ) : null}

          {clients.length > 1 ? (
            <Group title="Client scope">
              <Select
                value={state.clientId ?? ""}
                items={clientItems}
                onValueChange={(value: string | null) =>
                  onChange({ clientId: value ? value : undefined })
                }
              >
                <SelectTrigger
                  id={clientId}
                  aria-label="Filter by client"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(clientItems).map(([value, label]) => (
                    <SelectItem key={value || "all"} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Group>
          ) : null}

          <Group title="Assigned to">
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
          </Group>

          {ownerControl ? (
            <Group title="Waiting on">{ownerControl(ownerId)}</Group>
          ) : null}

          <Group title="Reply status">
            <ReplyFilter
              replyState={state.replyState}
              onChange={(replyState) => onChange({ replyState })}
            />
          </Group>

          <Group title="Age">{ageControl(ageId)}</Group>

          <Group title="Date range">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={dateFromId}
                  className="px-1 text-caption text-ink-muted"
                >
                  From date
                </label>
                <Input
                  id={dateFromId}
                  type="date"
                  aria-label="From date"
                  aria-invalid={rangeInverted || undefined}
                  value={state.dateFrom ? state.dateFrom.slice(0, 10) : ""}
                  onChange={(event) =>
                    setDate({ dateFrom: toIso(event.target.value) })
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={dateToId}
                  className="px-1 text-caption text-ink-muted"
                >
                  To date
                </label>
                <Input
                  id={dateToId}
                  type="date"
                  aria-label="To date"
                  aria-invalid={rangeInverted || undefined}
                  value={state.dateTo ? state.dateTo.slice(0, 10) : ""}
                  onChange={(event) =>
                    setDate({ dateTo: toIso(event.target.value) })
                  }
                />
              </div>
            </div>
            {rangeInverted ? (
              <p role="alert" className="text-caption text-danger-ink">
                The end date must be on or after the start date.
              </p>
            ) : null}
            {state.age ? (
              <p className="text-caption text-ink-muted">
                A date here replaces the Age preset.
              </p>
            ) : null}
          </Group>

          <Group title="Sort">
            <ReviewSortSelect
              state={state}
              onChange={onChange}
              className="w-full"
            />
          </Group>
        </div>

        {/* SheetFooter, so this panel's action row is the same object as
            every other sheet's rather than a lookalike. */}
        <SheetFooter className="flex-row items-center justify-between border-t border-line-subtle px-6 py-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:justify-between">
          <Button variant="ghost" onClick={onClear}>
            Clear filters
          </Button>
          <Button pill onClick={() => onOpenChange(false)}>
            Show results
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export { FiltersSheet }
