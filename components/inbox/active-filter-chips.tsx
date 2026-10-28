"use client"

import { Button } from "@/components/ui/button"
import { FilterChip, FilterChipStrip } from "@/components/ui/chip"
import {
  ASSIGNEE_LABELS,
  CLEAR_FILTERS_LABEL,
  FILTER_NAMES,
  REPLY_STATE_LABELS,
  WRITTEN_LABELS,
  formatDateRangeChip,
  formatSortChip,
  removeFilterLabel,
} from "@/lib/inbox/filter-labels"
import { REVIEW_AGE_LABELS } from "@/lib/inbox/review-age"
import { hasActiveFilters, type InboxState } from "@/lib/inbox/url-state"

// Structural, not the wire schema's LocationEntry: the filter UI reads a name
// off an id and nothing else, so tying it to the API payload would make every
// added field a breaking change for this component and its fixtures.
export type LocationOption = { id: string; name: string }

type Chip = { key: string; label: string; clear: Partial<InboxState> }

function buildChips(state: InboxState, locations: LocationOption[]): Chip[] {
  const chips: Chip[] = []
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
  // Rating and "With text" are pressed chips above the list (QuickFilters),
  // so they are not drawn a second time here. "Rating only" has no chip
  // there, so it is.
  if (state.written === "rating_only") {
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
 * Each is the primitive `FilterChip` in its applied state: the whole capsule
 * is the remove control (a 20px cross inside it was too small to hit on a
 * phone, and a capsule that only shows a filter has nothing else to do when
 * pressed), drawn `--np-chip-h` tall in the accent tint with a trailing ×,
 * the touch extension taking its target to 44px. Its name says what pressing
 * it does ("Remove filter: Rating: 1–2 stars"), in the inbox's own wording.
 * The strip (`FilterChipStrip`) is one row that scrolls sideways with faded
 * edges rather than wrapping or cutting a label short, and it keeps focus on
 * a neighbour when the focused chip goes. When the last one goes (or "Clear
 * all filters" empties the strip), `onEmpty` says where focus goes instead.
 */
function ActiveFilterChips({
  state,
  locations,
  clientChip,
  onChange,
  onClear,
  onEmpty,
}: {
  state: InboxState
  locations: LocationOption[]
  /**
   * Passed only when the app bar shows no client switcher (the agency has one
   * client or none): then the scope gets a removable chip here, since nothing
   * else shows or clears it. Resolved by the caller, which holds the clients.
   */
  clientChip?: { name?: string; onRemove: () => void }
  onChange: (partial: Partial<InboxState>) => void
  onClear: () => void
  /** Focus has nowhere left in the strip: the caller puts it somewhere useful. */
  onEmpty?: () => void
}) {
  // The client scope lives in the app bar, so it is not a filter here: a
  // scoped inbox with nothing narrowed shows no chip row and no "Clear all".
  const filtered = hasActiveFilters({ ...state, clientId: undefined })
  // The one exception: with no switcher to show or clear it (an agency with a
  // single client), the scope would otherwise narrow the list with no sign.
  const scope = clientChip && state.clientId ? clientChip : null
  if (!filtered && !scope) return null
  const chips = buildChips(state, locations)
  return (
    <FilterChipStrip
      data-slot="active-filter-chips"
      className="items-center"
      onEmpty={onEmpty}
    >
      {scope ? (
        <FilterChip
          removeLabel={removeFilterLabel(
            `${FILTER_NAMES.client}: ${scope.name ?? "selected"}`
          )}
          onRemove={scope.onRemove}
        >
          {`${FILTER_NAMES.client}: ${scope.name ?? "selected"}`}
        </FilterChip>
      ) : null}
      {chips.map((chip) => (
        <FilterChip
          key={chip.key}
          removeLabel={removeFilterLabel(chip.label)}
          onRemove={() => onChange(chip.clear)}
        >
          {chip.label}
        </FilterChip>
      ))}
      {filtered ? (
        <Button
          variant="link"
          onClick={onClear}
          className="min-h-(--np-touch) shrink-0 desk:min-h-0"
        >
          {CLEAR_FILTERS_LABEL}
        </Button>
      ) : null}
    </FilterChipStrip>
  )
}

export { ActiveFilterChips }
