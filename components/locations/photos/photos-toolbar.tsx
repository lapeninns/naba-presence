"use client"

import { PlusIcon, RefreshCwIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ToggleChip } from "@/components/ui/chip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { MediaCategory } from "@/lib/api/location-media"
import { formatNumber } from "@/lib/format"
import { humaniseCategory } from "@/lib/locations/media-labels"
import {
  OWNERSHIP_FILTERS,
  type CategoryFilter,
  type PhotosState,
} from "@/lib/locations/photos-url-state"

/** Heading, item count, refresh/add actions and the two browse filters. */
export function PhotosToolbar({
  total,
  categories,
  state,
  onStateChange,
  refreshing,
  onRefresh,
  disabled,
  onAdd,
}: {
  total: number
  categories: readonly MediaCategory[]
  state: PhotosState
  onStateChange: (partial: Partial<PhotosState>) => void
  refreshing: boolean
  onRefresh: () => void
  disabled: boolean
  onAdd: () => void
}) {
  return (
    <div className="@container/photo-toolbar flex flex-col gap-3 border-b border-line-subtle px-(--np-card-pad) py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-title font-semibold text-ink">Photo library</h2>
            <Badge variant="secondary">
              {formatNumber(total)} {total === 1 ? "item" : "items"}
            </Badge>
          </div>
          <p className="mt-0.5 text-caption text-ink-muted">
            Browse and manage the photos and videos visible on your Google
            listing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCwIcon
              aria-hidden
              strokeWidth={1.75}
              className={refreshing ? "animate-spin" : undefined}
              data-icon="inline-start"
            />
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
          <Button pill size="sm" disabled={disabled} onClick={onAdd}>
            <PlusIcon aria-hidden strokeWidth={1.75} data-icon="inline-start" />
            Add photos
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 @min-[42rem]/photo-toolbar:flex-row @min-[42rem]/photo-toolbar:items-center @min-[42rem]/photo-toolbar:justify-between">
        <div
          role="group"
          aria-label="Photo ownership"
          className="flex flex-wrap items-center gap-1.5"
        >
          {OWNERSHIP_FILTERS.map((option) => (
            <ToggleChip
              key={option.value}
              pressed={state.ownership === option.value}
              onClick={() =>
                onStateChange({ ownership: option.value, page: 1 })
              }
            >
              {option.label}
            </ToggleChip>
          ))}
        </div>
        <label className="flex min-w-0 items-center gap-2 text-ui">
          <span className="text-ui text-ink-muted">Category</span>
          <Select
            value={state.category}
            onValueChange={(next) =>
              onStateChange({ category: next as CategoryFilter, page: 1 })
            }
          >
            <SelectTrigger
              className="w-full sm:w-52"
              aria-label="Filter by category"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {humaniseCategory(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
    </div>
  )
}
