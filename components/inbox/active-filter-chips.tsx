"use client"

import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { LocationEntry } from "@/lib/api/locations"
import { hasActiveFilters, type InboxState } from "@/lib/inbox/url-state"

type Chip = { label: string; removeLabel: string; clear: Partial<InboxState> }

function buildChips(state: InboxState, locations: LocationEntry[]): Chip[] {
  const chips: Chip[] = []
  if (state.locationId) {
    const name =
      locations.find((location) => location.id === state.locationId)?.name ??
      "location"
    chips.push({
      label: `Location: ${name}`,
      removeLabel: "Remove location filter",
      clear: { locationId: undefined },
    })
  }
  if (state.ratings.length) {
    chips.push({
      label: `Rating: ${state.ratings.join(", ")}`,
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
      label: `Reply: ${state.replyState === "replied" ? "Replied" : "Not replied"}`,
      removeLabel: "Remove reply-state filter",
      clear: { replyState: undefined },
    })
  }
  if (state.verification.length) {
    chips.push({
      label: `Verification: ${state.verification.join(", ")}`,
      removeLabel: "Remove verification filter",
      clear: { verification: [] },
    })
  }
  if (state.publishStatus.length) {
    chips.push({
      label: `Publish: ${state.publishStatus.join(", ")}`,
      removeLabel: "Remove publish-status filter",
      clear: { publishStatus: [] },
    })
  }
  if (state.syncStatus.length) {
    chips.push({
      label: `Sync: ${state.syncStatus.join(", ")}`,
      removeLabel: "Remove sync-status filter",
      clear: { syncStatus: [] },
    })
  }
  if (state.dateFrom || state.dateTo) {
    chips.push({
      label: "Date range",
      removeLabel: "Remove date filter",
      clear: { dateFrom: undefined, dateTo: undefined },
    })
  }
  return chips
}

function ActiveFilterChips({
  state,
  locations,
  onChange,
  onClear,
}: {
  state: InboxState
  locations: LocationEntry[]
  onChange: (partial: Partial<InboxState>) => void
  onClear: () => void
}) {
  if (!hasActiveFilters(state)) return null
  const chips = buildChips(state, locations)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <span
          key={chip.removeLabel}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-caption"
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
