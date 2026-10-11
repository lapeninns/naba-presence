"use client"

import { useState } from "react"

import { DeletePhotoDialog } from "@/components/locations/photos/delete-photo-dialog"
import { MediaCard } from "@/components/locations/photos/media-card"
import { PhotoPreview } from "@/components/locations/photos/photo-preview"
import { LoadMore } from "@/components/ui/load-more"
import { TooltipProvider } from "@/components/ui/tooltip"
import { answerOutcome } from "@/lib/editors/outcome"
import {
  updateMediaCategory,
  type MediaCategory,
  type MediaItem,
  type MediaMutationResult,
} from "@/lib/api/location-media"
import type { ListPaging } from "@/lib/queries/paged-list"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

/**
 * The gallery (reference `.gallery`), a keyset page at a time. Owns the per-photo actions:
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
  total,
  paging,
  disabled,
  writeReason,
  onChanged,
}: {
  locationId: string
  items: MediaItem[]
  patchCategories: MediaCategory[]
  /** Every item matching the filters, loaded or not. */
  total: number
  paging: ListPaging
  disabled: boolean
  writeReason?: string | null
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
    mutationFn: (input, intent) =>
      updateMediaCategory(
        locationId,
        input.item.id,
        {
          category: input.category,
          expectedGoogleHash: input.item.googleHash,
        },
        { intentId: intent.intentId }
      ),
    invalidate: onChanged,
    successToast: (result, input) => {
      const what = input.category === "LOGO" ? "Logo" : "Category"
      const outcome = answerOutcome(result)
      return {
        outcome,
        title:
          outcome === "confirmed_applied"
            ? `${what} updated on Google`
            : `${what} change sent to Google`,
      }
    },
  })
  const updatingId = changeCategory.isPending
    ? (changeCategory.variables?.item.id ?? null)
    : null

  const moveTo = (item: MediaItem, category: MediaCategory) => {
    if (category === item.category) return
    changeCategory.mutate({ item, category })
  }

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

      <LoadMore
        shown={items.length}
        total={total}
        noun={["item", "items"]}
        paging={paging}
      />

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
