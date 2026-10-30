"use client"

import { useId, useRef } from "react"

import type { LocationOption } from "@/components/inbox/active-filter-chips"
import { WrittenFilter } from "@/components/inbox/filter-controls"
import { useReviewTopicsEnabled } from "@/components/reports/review-topics-enabled"
import { ReviewSortSelect } from "@/components/inbox/review-filters"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel, FormError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { usePhoneOverlay } from "@/components/ui/overlay"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  ASSIGNEE_LABELS,
  CLEAR_FILTERS_LABEL,
  FILTER_NAMES,
  resultsAnnouncement,
  showResultsLabel,
} from "@/lib/inbox/filter-labels"
import { REVIEW_TOPIC_LABELS, isReviewTopic } from "@/lib/domain/review-topics"
import { hasActiveFilters, type InboxState } from "@/lib/inbox/url-state"
import { cn } from "@/lib/utils"

/**
 * One filter under its heading. A group named by that heading, not a named
 * `<section>`: a group keeps its controls' shared name ("Date range" for
 * From and To) without making the sheet a dozen landmarks. Where the control
 * is already a group of that name (the written-review radio group),
 * `controlNamed` leaves the wrapper plain, so the name is not
 * announced twice.
 */
function Group({
  title,
  children,
  className,
  controlNamed = false,
}: {
  title: string
  children: React.ReactNode
  className?: string
  controlNamed?: boolean
}) {
  const headingId = useId()
  return (
    <section
      role={controlNamed ? undefined : "group"}
      aria-labelledby={controlNamed ? undefined : headingId}
      className={cn(
        "flex flex-col gap-3 border-t border-line-subtle py-4 first:border-t-0 first:pt-0",
        className
      )}
    >
      <h3 id={headingId} className="text-ui font-semibold text-ink">
        {title}
      </h3>
      {children}
    </section>
  )
}

const ASSIGNEE_ITEMS: Record<string, string> = {
  "": "Anyone",
  ...ASSIGNEE_LABELS,
}

const TOPIC_ITEMS: Record<string, string> = {
  "": "Any topic",
  ...REVIEW_TOPIC_LABELS,
}

/**
 * The narrowings the inbox keeps off the page, in one sheet (reference
 * `#filters`). The two commonest, star rating and "With text", are one-tap
 * chips above the list (QuickFilters), so the sheet does not repeat the
 * ratings. It holds no client (that scope is the app bar's) and no reply
 * status (the queue tabs already say which reviews are waiting). On a
 * phone it is the Sheet's `full` variant: the bottom sheet at full height,
 * where the thumb is, with the title centred in the bar (more than seven
 * controls, so not the `inset` card). From there up it stays the default
 * edge sheet, a right-hand panel beside the list it narrows.
 *
 * The toolbar keeps a few of these on screen where the width allows (see
 * FilterToolbar); the sheet holds all of them at every width, so a phone
 * loses nothing. Changes apply as they are made, and the footer's main
 * button says how many reviews the filters leave ("Show 12 reviews") and
 * closes the sheet on them. The pipeline-state checkboxes and saved presets
 * an older panel carried are gone: they filtered on an engineer's view of a
 * record, not a question an operator asks.
 */
function FiltersSheet({
  open,
  onOpenChange,
  resultLabel,
  state,
  locations,
  showLocationFilter,
  onChange,
  onClear,
  ageControl,
  ownerControl,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The list's count label ("12 reviews", "Loading reviews…"). */
  resultLabel: string
  state: InboxState
  locations: LocationOption[]
  /** False for a single-location org, which has no venue to choose. */
  showLocationFilter: boolean
  onChange: (partial: Partial<InboxState>) => void
  onClear: () => void
  /** The age select, drawn by the toolbar so both copies stay identical. */
  ageControl: (id: string) => React.ReactNode
  /** "Waiting on", inside Approval only. */
  ownerControl?: (id: string) => React.ReactNode
}) {
  const venueId = useId()
  const topicId = useId()
  // S3: offered only where reviews can carry topics; a `?topic=` link keeps
  // its chip either way, so it can always be cleared.
  const topicsEnabled = useReviewTopicsEnabled()
  const assigneeId = useId()
  const ageId = useId()
  const ownerId = useId()
  const phone = usePhoneOverlay()
  const showRef = useRef<HTMLButtonElement>(null)
  // Clear is offered only when there is something for it to clear (the
  // client scope is the app bar's, so it does not count).
  const filtered = hasActiveFilters({ ...state, clientId: undefined })
  const venueItems: Record<string, string> = {
    "": "All venues",
    ...Object.fromEntries(
      locations.map((location) => [location.id, location.name])
    ),
  }
  // A venue from a stale link that is not in the list reads as "All venues"
  // here; its chip above the list still names and clears it.
  const venueValue =
    state.locationIds[0] && state.locationIds[0] in venueItems
      ? state.locationIds[0]
      : ""

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
      <SheetContent
        data-slot="inbox-filters-sheet"
        variant={phone ? "full" : "edge"}
        className="sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>
            Changes apply as you make them. Star ratings are the chips above the
            list.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="gap-0">
          {/* Stars with no words are replied to from a standard template, a
              whole selection at a time — this is how to gather them. */}
          <Group title={FILTER_NAMES.written} controlNamed>
            <WrittenFilter
              written={state.written}
              onChange={(written) => onChange({ written })}
            />
          </Group>

          {/* Only the control is hidden for a single-location org, never the
              chip that clears a stale `?locationId=` arriving from a deep
              link — hiding both strands the operator in a filtered view. */}
          {showLocationFilter ? (
            <Group title={FILTER_NAMES.venue}>
              <Select
                value={venueValue}
                items={venueItems}
                onValueChange={(value: string | null) =>
                  onChange({ locationIds: value ? [value] : [] })
                }
              >
                <SelectTrigger
                  id={venueId}
                  aria-label="Filter by location"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent title="Venue" alignItemWithTrigger={false}>
                  {Object.entries(venueItems).map(([value, label]) => (
                    <SelectItem key={value || "all"} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Group>
          ) : null}

          {topicsEnabled ? (
            <Group title={FILTER_NAMES.topic}>
              <Select
                value={state.topic ?? ""}
                items={TOPIC_ITEMS}
                onValueChange={(value: string | null) =>
                  onChange({
                    topic: isReviewTopic(value) ? value : undefined,
                    // Topics come from review text: "Rating only" would
                    // leave nothing to show.
                    ...(isReviewTopic(value) && state.written === "rating_only"
                      ? { written: undefined }
                      : {}),
                  })
                }
              >
                <SelectTrigger
                  id={topicId}
                  aria-label="Filter by topic"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent title="Topic" alignItemWithTrigger={false}>
                  {Object.entries(TOPIC_ITEMS).map(([value, label]) => (
                    <SelectItem key={value || "any"} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Group>
          ) : null}

          <Group title={FILTER_NAMES.assignee}>
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
              <SelectContent title="Assignee" alignItemWithTrigger={false}>
                {Object.entries(ASSIGNEE_ITEMS).map(([value, label]) => (
                  <SelectItem key={value || "anyone"} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Group>

          {ownerControl ? (
            <Group title={FILTER_NAMES.owner}>{ownerControl(ownerId)}</Group>
          ) : null}

          <Group title={FILTER_NAMES.age}>{ageControl(ageId)}</Group>

          <Group title={FILTER_NAMES.dates}>
            <div className="grid grid-cols-2 gap-2">
              <Field>
                <FieldLabel className="font-normal text-ink-muted">
                  From date
                </FieldLabel>
                <Input
                  type="date"
                  aria-invalid={rangeInverted || undefined}
                  value={state.dateFrom ? state.dateFrom.slice(0, 10) : ""}
                  onChange={(event) =>
                    setDate({ dateFrom: toIso(event.target.value) })
                  }
                />
              </Field>
              <Field>
                <FieldLabel className="font-normal text-ink-muted">
                  To date
                </FieldLabel>
                <Input
                  type="date"
                  aria-invalid={rangeInverted || undefined}
                  value={state.dateTo ? state.dateTo.slice(0, 10) : ""}
                  onChange={(event) =>
                    setDate({ dateTo: toIso(event.target.value) })
                  }
                />
              </Field>
            </div>
            {/* Said, not just drawn red: an inverted range quietly matches
                nothing, which reads as "no reviews" rather than a mistake. */}
            <FormError>
              {rangeInverted
                ? "The end date must be on or after the start date."
                : null}
            </FormError>
            {state.age ? (
              <p className="text-caption text-ink-muted">
                A date here replaces the Age preset.
              </p>
            ) : null}
          </Group>

          <Group title={FILTER_NAMES.sort}>
            <ReviewSortSelect
              state={state}
              onChange={onChange}
              className="w-full"
            />
          </Group>
        </SheetBody>

        {/* The primitive's footer: stacked on a phone with the main button
            nearest the thumb, a right-aligned row on the panel. The main
            button carries the live count, so the sheet says what closing it
            will show; the sheet is modal, so the list's own count
            announcement is out of reach while it is open, and this status
            says the new count instead. */}
        <SheetFooter>
          <p role="status" className="sr-only">
            {resultsAnnouncement(resultLabel)}
          </p>
          {filtered ? (
            <Button
              variant="ghost"
              onClick={() => {
                onClear()
                // The button goes with the filters: focus stays in the
                // sheet, on the button that shows the result.
                showRef.current?.focus()
              }}
            >
              {CLEAR_FILTERS_LABEL}
            </Button>
          ) : null}
          <Button ref={showRef} onClick={() => onOpenChange(false)}>
            {showResultsLabel(resultLabel)}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export { FiltersSheet }
