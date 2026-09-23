"use client"

import { RefreshCwIcon } from "lucide-react"
import { useId } from "react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  segmentedItemClassName,
  segmentedThumbClassName,
  segmentedTrackClassName,
} from "@/components/ui/segmented-control"
import type { MediaCategory } from "@/lib/api/location-media"
import { humaniseCategory } from "@/lib/locations/media-labels"
import {
  OWNERSHIP_FILTERS,
  type CategoryFilter,
  type PhotosState,
} from "@/lib/locations/photos-url-state"
import { cn } from "@/lib/utils"

/**
 * The browse row above the gallery (reference `.toolbar-row`): who added the
 * photo, which Google category, and a re-read from Google.
 *
 * Ownership is drawn as the segmented track but keeps its `aria-pressed`
 * buttons: the filter narrows one list rather than switching panels. The
 * categories stay a list rather than chips because Google offers thirteen of
 * them, which as chips would be a row most of the screen never shows.
 */
export function PhotosToolbar({
  categories,
  state,
  onStateChange,
  refreshing,
  onRefresh,
}: {
  categories: readonly MediaCategory[]
  state: PhotosState
  onStateChange: (partial: Partial<PhotosState>) => void
  refreshing: boolean
  onRefresh: () => void
}) {
  const categoryLabelId = useId()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div
        role="group"
        aria-label="Photo ownership"
        className={cn(segmentedTrackClassName, "w-full sm:w-auto sm:shrink-0")}
      >
        {OWNERSHIP_FILTERS.map((option) => {
          const pressed = state.ownership === option.value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={pressed}
              onClick={() =>
                onStateChange({ ownership: option.value, page: 1 })
              }
              className={cn(
                segmentedItemClassName,
                "flex-auto shrink-0",
                pressed && segmentedThumbClassName
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>

      <div className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto">
        <span id={categoryLabelId} className="text-ui text-ink-muted">
          Category
        </span>
        <Select
          value={state.category}
          onValueChange={(next) =>
            onStateChange({ category: next as CategoryFilter, page: 1 })
          }
        >
          <SelectTrigger
            className="min-w-0 flex-1 sm:w-52 sm:flex-none"
            aria-label="Filter by category"
            aria-describedby={categoryLabelId}
          >
            <SelectValue>
              {(value: string | null) =>
                !value || value === "all"
                  ? "All categories"
                  : humaniseCategory(value)
              }
            </SelectValue>
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
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="sm:ml-auto"
        onClick={onRefresh}
        pending={refreshing}
        pendingLabel="Refreshing…"
      >
        <RefreshCwIcon aria-hidden />
        Refresh from Google
      </Button>
    </div>
  )
}
