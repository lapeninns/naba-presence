"use client"

import { useQueryClient } from "@tanstack/react-query"
import { FilterIcon, ImagesIcon, PlusIcon } from "lucide-react"
import { useState } from "react"

import { EditorFrame } from "@/components/editors/editor-frame"
import { AddPhotoDialog } from "@/components/locations/photos/add-photo-dialog"
import { PhotosGrid } from "@/components/locations/photos/photos-grid"
import { PhotosToolbar } from "@/components/locations/photos/photos-toolbar"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { fetchMedia, type MediaState } from "@/lib/api/location-media"
import { formatNumber } from "@/lib/format"
import { isPatchableMediaCategory } from "@/lib/locations/media-labels"
import {
  hasActivePhotoFilters,
  toMediaQuery,
  type PhotosState,
} from "@/lib/locations/photos-url-state"
import { DEFAULT_MEDIA_PAGE_SIZE } from "@/lib/media-page"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

/**
 * The loaded photos tab (reference `listing-photos.html`): heading with the
 * library's size and the Add action, the capability banner, the browse row,
 * then the gallery or an empty state, and the add-media dialog.
 *
 * Owns the one "refresh from Google" mutation that every write re-runs
 * afterwards, so the gallery always shows what Google holds.
 */
export function PhotosLibrary({
  locationId,
  media,
  state,
  onStateChange,
  writeReason,
}: {
  locationId: string
  media: MediaState
  state: PhotosState
  onStateChange: (partial: Partial<PhotosState>) => void
  writeReason: string | null
}) {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const disabled = Boolean(writeReason)
  const query = toMediaQuery(state)
  const pageCount = Math.max(1, Math.ceil(media.total / media.pageSize))
  const page = Math.min(state.page, pageCount)
  const filtersActive = hasActivePhotoFilters(state)

  // Re-read page 1 straight from Google, seed its cache entry, then drop every
  // other page/filter of this location's media so they refetch on demand.
  const refresh = useResourceMutation<MediaState>({
    mutationFn: () =>
      fetchMedia(locationId, {
        page: 1,
        pageSize: DEFAULT_MEDIA_PAGE_SIZE,
        refresh: true,
        category: query.category ?? undefined,
        ownership: query.ownership ?? undefined,
      }),
    onSuccess: (fresh) => {
      queryClient.setQueryData(
        queryKeys.locationMedia(locationId, {
          page: 1,
          category: query.category,
          ownership: query.ownership,
        }),
        fresh
      )
      if (state.page !== 1) onStateChange({ page: 1 })
    },
    invalidate: [queryKeys.locationMediaAll(locationId)],
  })
  const refreshFromGoogle = () => refresh.mutate()

  const statusLabel =
    media.total === 0
      ? filtersActive
        ? "No matches"
        : "No photos"
      : `${formatNumber(media.total)} ${media.total === 1 ? "item" : "items"}${filtersActive ? " match" : " on Google"}`

  return (
    <EditorFrame
      title="Photo library"
      statusLabel={statusLabel}
      tone={media.total === 0 ? "neutral" : "healthy"}
      description="Every photo on the listing, yours and your customers’. There is no draft step: adding, moving or deleting a photo changes Google."
      gateReason={writeReason}
      gateTitle="You can look, but not change these photos"
      actions={
        <Button disabled={disabled} onClick={() => setAddOpen(true)}>
          <PlusIcon aria-hidden />
          Add photos
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <PhotosToolbar
          categories={media.categories}
          state={state}
          onStateChange={onStateChange}
          refreshing={refresh.isPending}
          onRefresh={refreshFromGoogle}
        />

        {media.total === 0 ? (
          <div className="rounded-lg border border-line bg-surface">
            <PhotosEmpty
              filtersActive={filtersActive}
              onClearFilters={() =>
                onStateChange({ ownership: "all", category: "all", page: 1 })
              }
            />
          </div>
        ) : (
          <PhotosGrid
            locationId={locationId}
            items={media.items}
            patchCategories={media.categories.filter(isPatchableMediaCategory)}
            page={page}
            pageCount={pageCount}
            total={media.total}
            pageSize={media.pageSize}
            disabled={disabled}
            writeReason={writeReason}
            onPageChange={(next) => onStateChange({ page: next })}
            onChanged={refreshFromGoogle}
          />
        )}
      </div>

      <AddPhotoDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        locationId={locationId}
        categories={media.categories}
        writeReason={writeReason}
        onAdded={refreshFromGoogle}
      />
    </EditorFrame>
  )
}

// No "Add photos" action here on purpose: the heading directly above always
// renders one, wired to the same handler. Offering it twice on one screen
// gave the same action two accessible names in the same view.
function PhotosEmpty({
  filtersActive,
  onClearFilters,
}: {
  filtersActive: boolean
  onClearFilters: () => void
}) {
  return (
    <Empty
      icon={filtersActive ? <FilterIcon /> : <ImagesIcon />}
      titleAs="h3"
      title={filtersActive ? "No matching photos" : "No photos yet"}
      description={
        filtersActive
          ? "Try a different ownership or category filter."
          : "Google has no photos for this listing. Add the first ones above, or refresh from Google if the client added some there directly."
      }
      action={
        filtersActive ? (
          <Button variant="secondary" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  )
}
