"use client"

import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  formatDateRangeChip,
  formatPublishStatusChip,
  formatRatingsChip,
  formatSortChip,
  formatSyncStatusChip,
  formatVerificationChip,
} from "@/lib/inbox/filter-labels"
import { hasActiveFilters, type InboxState } from "@/lib/inbox/url-state"

// Structural, not the wire schema's LocationEntry: the filter UI reads a name
// off an id and nothing else, so tying it to the API payload would make every
// added field a breaking change for this component and its fixtures.
export type LocationOption = { id: string; name: string }

type Chip = { label: string; removeLabel: string; clear: Partial<InboxState> }

function buildChips(
  state: InboxState,
  locations: LocationOption[],
  clientName?: string
): Chip[] {
  const chips: Chip[] = []
  if (state.clientId) {
    chips.push({
      label: `Client: ${clientName ?? "selected"}`,
      removeLabel: "Remove client filter",
      clear: { clientId: undefined },
    })
  }
  if (state.locationIds.length === 1) {
    const name =
      locations.find((location) => location.id === state.locationIds[0])?.name ??
      "location"
    chips.push({
      label: `Location: ${name}`,
      removeLabel: "Remove location filter",
      clear: { locationIds: [] },
    })
  } else if (state.locationIds.length > 1) {
    chips.push({
      label: `${state.locationIds.length} locations`,
      removeLabel: "Remove location filter",
      clear: { locationIds: [] },
    })
  }
  if (state.assignee) {
    chips.push({
      label:
        state.assignee === "me"
          ? "Assigned to me"
          : state.assignee === "unassigned"
            ? "Unassigned"
            : "Assigned",
      removeLabel: "Remove assignee filter",
      clear: { assignee: undefined },
    })
  }
  if (state.ratings.length) {
    chips.push({
      label: formatRatingsChip(state.ratings),
      removeLabel: "Remove rating filter",
      clear: { ratings: [] },
    })
  }
  if (state.search) {
    chips.push({
      label: `Search: "${state.search}"`,
      removeLabel: "Remove search filter",
      clear: { search: "" },
    })
  }
  if (state.replyState) {
    chips.push({
      label: `Reply: ${state.replyState === "replied" ? "Replied" : "Unreplied"}`,
      removeLabel: "Remove reply-state filter",
      clear: { replyState: undefined },
    })
  }
  if (state.verification.length) {
    chips.push({
      label: formatVerificationChip(state.verification),
      removeLabel: "Remove verification filter",
      clear: { verification: [] },
    })
  }
  if (state.publishStatus.length) {
    chips.push({
      label: formatPublishStatusChip(state.publishStatus),
      removeLabel: "Remove publish-status filter",
      clear: { publishStatus: [] },
    })
  }
  if (state.syncStatus.length) {
    chips.push({
      label: formatSyncStatusChip(state.syncStatus),
      removeLabel: "Remove sync-status filter",
      clear: { syncStatus: [] },
    })
  }
  if (state.dateFrom || state.dateTo) {
    chips.push({
      label: formatDateRangeChip(state.dateFrom, state.dateTo),
      removeLabel: "Remove date filter",
      clear: { dateFrom: undefined, dateTo: undefined },
    })
  }
  if (state.sort && state.sort !== "updated_desc") {
    chips.push({
      label: formatSortChip(state.sort),
      removeLabel: "Remove sort",
      clear: { sort: "updated_desc" },
    })
  }
  return chips
}

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
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip.removeLabel}
          className="inline-flex h-6 items-center gap-0.5 rounded-(--np-radius-pill) border border-border/70 bg-muted/60 pr-1 pl-2.5 text-caption text-foreground"
        >
          {chip.label}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={chip.removeLabel}
            onClick={() => onChange(chip.clear)}
          >
            <XIcon aria-hidden />
          </Button>
        </span>
      ))}
      <Button variant="link" size="sm" onClick={onClear}>
        Clear all filters
      </Button>
    </div>
  )
}

export { ActiveFilterChips }
