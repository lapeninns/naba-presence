"use client"

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useState } from "react"

import { DeletePhotoDialog } from "@/components/locations/photos/delete-photo-dialog"
import { MediaCard } from "@/components/locations/photos/media-card"
import { PhotoPreview } from "@/components/locations/photos/photo-preview"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  updateMediaCategory,
  type MediaCategory,
  type MediaItem,
  type MediaMutationResult,
} from "@/lib/api/location-media"
import { formatNumber } from "@/lib/format"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

/**
 * The paginated card grid. Owns the per-card actions: moving an item to
 * another category (inline), previewing it, and the delete confirmation.
 */
export function PhotosGrid({
  locationId,
  items,
  patchCategories,
  page,
  pageCount,
  total,
  pageSize,
  disabled,
  onPageChange,
  onChanged,
}: {
  locationId: string
  items: MediaItem[]
  patchCategories: MediaCategory[]
  page: number
  pageCount: number
  total: number
  pageSize: number
  disabled: boolean
  onPageChange: (page: number) => void
  /** Called after any write succeeds, to re-read the library from Google. */
  onChanged: () => void
}) {
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MediaItem | null>(null)

  const changeCategory = useResourceMutation<
    MediaMutationResult,
    { item: MediaItem; category: MediaCategory }
  >({
    mutationFn: (input) =>
      updateMediaCategory(locationId, input.item.id, {
        category: input.category,
        expectedGoogleHash: input.item.googleHash,
      }),
    invalidate: onChanged,
    successToast: "Category updated",
  })
  const updatingId = changeCategory.isPending
    ? (changeCategory.variables?.item.id ?? null)
    : null

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, total)

  return (
    <>
      <TooltipProvider>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] gap-3 p-(--np-card-pad)">
          {items.map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              disabled={disabled}
              updating={updatingId === item.id}
              patchCategories={patchCategories}
              onOpen={() => setPreviewItem(item)}
              onCategoryChange={(next) => {
                if (next === item.category) return
                changeCategory.mutate({ item, category: next })
              }}
              onDelete={() => setDeleteTarget(item)}
            />
          ))}
        </ul>
      </TooltipProvider>

      <nav
        aria-label="Photo pages"
        className="flex flex-wrap items-center justify-between gap-2 border-t border-line-subtle px-(--np-card-pad) py-2.5"
      >
        <Button
          variant="ghost"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeftIcon aria-hidden strokeWidth={1.75} />
          Previous
        </Button>
        <span className="order-first w-full text-center text-caption text-ink-muted tabular-nums sm:order-none sm:w-auto">
          {formatNumber(rangeStart)}–{formatNumber(rangeEnd)} of{" "}
          {formatNumber(total)}
          {pageCount > 1 ? ` · Page ${page} of ${pageCount}` : null}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRightIcon aria-hidden strokeWidth={1.75} />
        </Button>
      </nav>

      <PhotoPreview
        item={previewItem}
        open={previewItem !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewItem(null)
        }}
      />
      <DeletePhotoDialog
        locationId={locationId}
        item={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={onChanged}
      />
    </>
  )
}
