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
 * The paginated gallery (reference `.gallery`). Owns the per-photo actions:
 * moving an item to another category, making it the logo, the lightbox and
 * the delete confirmation.
 *
 * Tiles are at least 10rem wide, so a phone shows two across from about
 * 360px and one across below that; a wide pane fits five or six.
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
  writeReason,
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
  writeReason?: string | null
  onPageChange: (page: number) => void
  /** Called after any write succeeds, to re-read the library from Google. */
  onChanged: () => void
}) {
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MediaItem | null>(null)
  const previewItem = items.find((item) => item.id === previewId) ?? null

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
    successToast: (result, input) => {
      const what = input.category === "LOGO" ? "Logo" : "Category"
      return result.status === "succeeded"
        ? `${what} updated on Google`
        : `${what} change sent to Google`
    },
  })
  const updatingId = changeCategory.isPending
    ? (changeCategory.variables?.item.id ?? null)
    : null

  const moveTo = (item: MediaItem, category: MediaCategory) => {
    if (category === item.category) return
    changeCategory.mutate({ item, category })
  }

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, total)

  return (
    <>
      <TooltipProvider>
        <ul
          aria-label="Photos"
          className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] gap-3"
        >
          {items.map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              disabled={disabled}
              updating={updatingId === item.id}
              patchCategories={patchCategories}
              onOpen={() => setPreviewId(item.id)}
              onCategoryChange={(next) => moveTo(item, next)}
              onDelete={() => setDeleteTarget(item)}
            />
          ))}
        </ul>
      </TooltipProvider>

      <nav
        aria-label="Photo pages"
        className="flex flex-wrap items-center justify-between gap-2"
      >
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeftIcon aria-hidden />
          Previous
        </Button>
        <span className="order-first w-full text-center font-mono text-caption text-ink-muted tabular-nums sm:order-none sm:w-auto">
          {formatNumber(rangeStart)}–{formatNumber(rangeEnd)} of{" "}
          {formatNumber(total)}
          {pageCount > 1 ? ` · Page ${page} of ${pageCount}` : null}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRightIcon aria-hidden />
        </Button>
      </nav>

      <PhotoPreview
        item={previewItem}
        items={items}
        open={previewItem !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewId(null)
        }}
        onNavigate={(next) => setPreviewId(next.id)}
        writeReason={writeReason}
        updating={previewItem ? updatingId === previewItem.id : false}
        onDelete={(item) => {
          setPreviewId(null)
          setDeleteTarget(item)
        }}
        onUseAsLogo={(item) => moveTo(item, "LOGO")}
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
