"use client"

import { PlusIcon, RefreshCwIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
    <div className="@container/photo-toolbar flex flex-col gap-3 border-b border-border/60 px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-title font-semibold">Photo library</h2>
            <Badge variant="secondary">
              {formatNumber(total)} {total === 1 ? "item" : "items"}
            </Badge>
          </div>
          <p className="mt-0.5 text-caption text-muted-foreground">
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
              className={refreshing ? "animate-spin" : undefined}
              data-icon="inline-start"
            />
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
          <Button size="sm" disabled={disabled} onClick={onAdd}>
            <PlusIcon aria-hidden data-icon="inline-start" />
            Add photos
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 @min-[42rem]/photo-toolbar:flex-row @min-[42rem]/photo-toolbar:items-end @min-[42rem]/photo-toolbar:justify-between">
        <div
          role="group"
          aria-label="Photo ownership"
          className="grid grid-cols-3 gap-1 rounded-(--nr-radius-control) bg-muted/70 p-1 sm:inline-grid"
        >
          {OWNERSHIP_FILTERS.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={state.ownership === option.value ? "secondary" : "ghost"}
              aria-pressed={state.ownership === option.value}
              onClick={() =>
                onStateChange({ ownership: option.value, page: 1 })
              }
              className="w-full"
            >
              {option.label}
            </Button>
          ))}
        </div>
        <label className="flex min-w-0 flex-col gap-1 text-ui sm:w-52">
          <span className="text-caption text-muted-foreground">Category</span>
          <Select
            value={state.category}
            onValueChange={(next) =>
              onStateChange({ category: next as CategoryFilter, page: 1 })
            }
          >
            <SelectTrigger className="w-full" aria-label="Filter by category">
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
