"use client"

import { useRef, useState } from "react"

import {
  DeletePhotoDialog,
  type DeletePhotoOutcome,
} from "@/components/locations/photos/delete-photo-dialog"
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
 * Columns follow the pane's own width (container queries on the named
 * scale, so no one-off lengths): one across below 20rem of pane (a 320px
 * phone), two from 20rem (a phone from about 360px), then three, four,
 * five, six and seven as the pane widens, which keeps every tile near the
 * old 10rem minimum. A 1440 desk pane shows five or six.
 *
 * After a delete, focus goes to the tile beside the deleted one (that tile
 * stays when the re-read lands; the deleted one's own controls do not), and
 * "Keep the photo" asked from the lightbox goes back to the lightbox.
 */
type DeleteTarget = {
  item: MediaItem
  /** Asked from the tile's bin or from the lightbox. */
  from: "tile" | "preview"
  /** The tile that takes focus once this one is deleted. */
  neighbourId: string | null
  /** Resolve the item from the re-read list (after a stale refusal). */
  followLatest: boolean
}

export function PhotosGrid({
  locationId,
  items,
  patchCategories,
  total,
  paging,
  disabled,
  writeReason,
  refreshing = false,
  fallbackFocusRef,
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
  /** A re-read from Google is running. */
  refreshing?: boolean
  /** Where focus goes when a delete leaves no tile to land on. */
  fallbackFocusRef?: React.RefObject<HTMLElement | null>
  /** Called after any write succeeds, to re-read the library from Google. */
  onChanged: () => void
}) {
  const [previewId, setPreviewId] = useState<string | null>(null)
  // The item as it was when the bin was pressed: what the person confirms
  // is what is sent (its hash and its intent). Only after a stale refusal
  // and a refresh does it follow the re-read, to the photo as Google has it.
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const previewItem = items.find((item) => item.id === previewId) ?? null
  // A refresh only re-reads the first page. A photo reached through Load
  // more may not be on it, so its stale copy can't be corrected here.
  const lostAfterRefresh =
    deleteTarget !== null &&
    deleteTarget.followLatest &&
    !refreshing &&
    !items.some((item) => item.id === deleteTarget.item.id)
  const deleteItem = deleteTarget
    ? deleteTarget.followLatest
      ? (items.find((item) => item.id === deleteTarget.item.id) ??
        deleteTarget.item)
      : deleteTarget.item
    : null
  const listRef = useRef<HTMLUListElement | null>(null)
  const closedDelete = useRef<{
    target: DeleteTarget
    outcome: DeletePhotoOutcome
  } | null>(null)

  const askDelete = (item: MediaItem, from: DeleteTarget["from"]) => {
    const index = items.findIndex((entry) => entry.id === item.id)
    const neighbour = items[index + 1] ?? items[index - 1] ?? null
    setDeleteTarget({
      item,
      from,
      neighbourId: neighbour?.id ?? null,
      followLatest: false,
    })
  }

  const tileButton = (id: string | null): HTMLElement | null => {
    if (!id || !listRef.current) return null
    const tile = Array.from(
      listRef.current.querySelectorAll<HTMLElement>("[data-media-id]")
    ).find((element) => element.dataset.mediaId === id)
    return tile?.querySelector<HTMLElement>("button") ?? null
  }

  const focusAfterDelete = (): HTMLElement | boolean | null => {
    const closed = closedDelete.current
    closedDelete.current = null
    if (!closed) return true
    const { target, outcome } = closed
    if (outcome === "deleted") {
      return tileButton(target.neighbourId) ?? fallbackFocusRef?.current ?? true
    }
    if (target.from === "preview") {
      // Kept: the lightbox opens again on the same photo and takes focus.
      if (outcome === "kept") return false
      return tileButton(target.item.id) ?? true
    }
    return true
  }

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
        <div className="@container/photos">
          <ul
            ref={listRef}
            aria-label="Photos"
            className="grid grid-cols-1 gap-x-3 gap-y-4 @xs/photos:grid-cols-2 @lg/photos:grid-cols-3 @2xl/photos:grid-cols-4 @4xl/photos:grid-cols-5 @5xl/photos:grid-cols-6 @7xl/photos:grid-cols-7"
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
                onDelete={() => askDelete(item, "tile")}
              />
            ))}
          </ul>
        </div>
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
        total={total}
        open={previewItem !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewId(null)
        }}
        onNavigate={(next) => setPreviewId(next.id)}
        writeReason={writeReason}
        updating={previewItem ? updatingId === previewItem.id : false}
        onDelete={(item) => {
          setPreviewId(null)
          askDelete(item, "preview")
        }}
        onUseAsLogo={(item) => moveTo(item, "LOGO")}
      />
      <DeletePhotoDialog
        locationId={locationId}
        item={deleteItem}
        onClose={(outcome) => {
          if (deleteTarget) {
            closedDelete.current = { target: deleteTarget, outcome }
            if (outcome === "kept" && deleteTarget.from === "preview")
              setPreviewId(deleteTarget.item.id)
          }
          setDeleteTarget(null)
        }}
        onDeleted={onChanged}
        onRefresh={() => {
          setDeleteTarget((current) =>
            current ? { ...current, followLatest: true } : current
          )
          onChanged()
        }}
        refreshing={refreshing}
        lost={lostAfterRefresh}
        finalFocus={focusAfterDelete}
      />
    </>
  )
}
