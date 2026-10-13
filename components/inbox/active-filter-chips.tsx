"use client"

import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ChipRow, chipClassName } from "@/components/ui/chip"
import {
  ASSIGNEE_LABELS,
  CLEAR_FILTERS_LABEL,
  FILTER_NAMES,
  REPLY_STATE_LABELS,
  WRITTEN_LABELS,
  formatDateRangeChip,
  formatRatingsChip,
  formatSortChip,
  removeFilterLabel,
} from "@/lib/inbox/filter-labels"
import { REVIEW_AGE_LABELS } from "@/lib/inbox/review-age"
import { hasActiveFilters, type InboxState } from "@/lib/inbox/url-state"
import { cn } from "@/lib/utils"

// Structural, not the wire schema's LocationEntry: the filter UI reads a name
// off an id and nothing else, so tying it to the API payload would make every
// added field a breaking change for this component and its fixtures.
export type LocationOption = { id: string; name: string }

type Chip = { key: string; label: string; clear: Partial<InboxState> }

function buildChips(
  state: InboxState,
  locations: LocationOption[],
  clientName?: string
): Chip[] {
  const chips: Chip[] = []
  if (state.clientId) {
    chips.push({
      key: "client",
      label: `${FILTER_NAMES.client}: ${clientName ?? "selected"}`,
      clear: { clientId: undefined },
    })
  }
  if (state.locationIds.length === 1) {
    const name =
      locations.find((location) => location.id === state.locationIds[0])
        ?.name ?? "selected"
    chips.push({
      key: "venue",
      label: `${FILTER_NAMES.venue}: ${name}`,
      clear: { locationIds: [] },
    })
  } else if (state.locationIds.length > 1) {
    chips.push({
      key: "venue",
      label: `${FILTER_NAMES.venue}: ${state.locationIds.length} venues`,
      clear: { locationIds: [] },
    })
  }
  if (state.assignee) {
    chips.push({
      key: "assignee",
      label: `${FILTER_NAMES.assignee}: ${ASSIGNEE_LABELS[state.assignee] ?? "someone"}`,
      clear: { assignee: undefined },
    })
  }
  if (state.ratings.length) {
    chips.push({
      key: "rating",
      label: formatRatingsChip(state.ratings),
      clear: { ratings: [] },
    })
  }
  if (state.written) {
    chips.push({
      key: "written",
      label: `${FILTER_NAMES.written}: ${WRITTEN_LABELS[state.written]}`,
      clear: { written: undefined },
    })
  }
  if (state.search) {
    chips.push({
      key: "search",
      label: `${FILTER_NAMES.search}: "${state.search}"`,
      clear: { search: "" },
    })
  }
  if (state.replyState) {
    chips.push({
      key: "reply",
      label: `${FILTER_NAMES.replyState}: ${REPLY_STATE_LABELS[state.replyState]}`,
      clear: { replyState: undefined },
    })
  }
  if (state.age) {
    chips.push({
      key: "age",
      label: `${FILTER_NAMES.age}: ${REVIEW_AGE_LABELS[state.age]}`,
      clear: { age: undefined },
    })
  }
  if (state.dateFrom || state.dateTo) {
    chips.push({
      key: "dates",
      label: formatDateRangeChip(state.dateFrom, state.dateTo),
      clear: { dateFrom: undefined, dateTo: undefined },
    })
  }
  if (state.sort && state.sort !== "updated_desc") {
    chips.push({
      key: "sort",
      label: formatSortChip(state.sort),
      clear: { sort: "updated_desc" },
    })
  }
  return chips
}

/**
 * The filters in force, as removable capsules, so the reason a list is short
 * is always on screen next to it.
 *
 * The whole capsule is the remove control rather than a 20px cross inside
 * it: on a phone the cross was the only target and too small to hit, and a
 * capsule that only shows a filter has nothing else to do when pressed. Its
 * name says what pressing it does ("Remove filter: Rating: 1–2 stars").
 * Each chip is drawn at the small control height in the accent tint, with
 * the touch extension taking its target to 44px.
 */
function ActiveFilterChips({
  state,
  locations,
  clientName,
  onChange,
  onClear,
}: {
  state: InboxState
  locations: LocationOption[]
  /** Resolved by the caller, which already holds the client list. */
  clientName?: string
  onChange: (partial: Partial<InboxState>) => void
  onClear: () => void
}) {
  if (!hasActiveFilters(state)) return null
  const chips = buildChips(state, locations, clientName)
  return (
    // One row that scrolls sideways (fading at the edge with more behind it)
    // rather than wrapping or cutting a label short.
    <ChipRow data-slot="active-filter-chips" className="items-center">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          data-slot="chip"
          aria-label={removeFilterLabel(chip.label)}
          onClick={() => onChange(chip.clear)}
          className={chipClassName({
            className: cn(
              // Applied, so drawn in the accent tint; the hit area reaches
              // 44px on touch through the chip's own extension.
              "border-transparent bg-accent-tint pr-2 font-semibold text-accent-ink",
              "hover-fine:hover:border-transparent hover-fine:hover:bg-accent-tint",
              "[&_svg]:text-accent-ink"
            ),
          })}
        >
          <span>{chip.label}</span>
          <XIcon aria-hidden strokeWidth={1.75} />
        </button>
      ))}
      <Button
        variant="link"
        onClick={onClear}
        className="min-h-(--np-touch) shrink-0 desk:min-h-0"
      >
        {CLEAR_FILTERS_LABEL}
      </Button>
    </ChipRow>
  )
}

export { ActiveFilterChips }
