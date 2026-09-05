"use client"

import { useQueryClient } from "@tanstack/react-query"
import { ImagesIcon } from "lucide-react"
import { useState } from "react"

import { AddPhotoDialog } from "@/components/locations/photos/add-photo-dialog"
import { PhotosGrid } from "@/components/locations/photos/photos-grid"
import { PhotosToolbar } from "@/components/locations/photos/photos-toolbar"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { fetchMedia, type MediaState } from "@/lib/api/location-media"
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
 * The loaded photos tab: toolbar, gate note, grid or empty state, and the
 * add-media dialog. Owns the one "refresh from Google" mutation that every
 * write re-runs afterwards, so the grid always reflects what Google holds.
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

  return (
    <div className="flex flex-col gap-4">
      <section className="overflow-hidden rounded-(--np-radius-card) bg-surface">
        <PhotosToolbar
          total={media.total}
          categories={media.categories}
          state={state}
          onStateChange={onStateChange}
          refreshing={refresh.isPending}
          onRefresh={refreshFromGoogle}
          disabled={disabled}
          onAdd={() => setAddOpen(true)}
        />

        {media.total === 0 ? (
          <PhotosEmpty
            filtersActive={filtersActive}
            onClearFilters={() =>
              onStateChange({ ownership: "all", category: "all", page: 1 })
            }
          />
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
            onPageChange={(next) => onStateChange({ page: next })}
            onChanged={refreshFromGoogle}
          />
        )}
      </section>

      <AddPhotoDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        locationId={locationId}
        categories={media.categories}
        writeReason={writeReason}
        onAdded={refreshFromGoogle}
      />
    </div>
  )
}

// No "Add photos" action here on purpose: the toolbar directly above this
// panel always renders one, wired to the same handler. Offering it twice on
// one screen gave the same action two accessible names in the same view, and
// left the operator guessing whether the two buttons did different things.
function PhotosEmpty({
  filtersActive,
  onClearFilters,
}: {
  filtersActive: boolean
  onClearFilters: () => void
}) {
  return (
    <Empty
      icon={<ImagesIcon />}
      title={filtersActive ? "No matching photos" : "No photos yet"}
      description={
        filtersActive
          ? "Try a different ownership or category filter."
          : "Add high-quality photos to help customers understand what to expect."
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
