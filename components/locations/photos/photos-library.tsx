"use client"

import { useQueryClient } from "@tanstack/react-query"
import { ImagesIcon, PlusIcon } from "lucide-react"
import { useState } from "react"

import { AddPhotoDialog } from "@/components/locations/photos/add-photo-dialog"
import { PhotosGrid } from "@/components/locations/photos/photos-grid"
import { PhotosToolbar } from "@/components/locations/photos/photos-toolbar"
import { GateNote } from "@/components/locations/publish-gate"
import { Button } from "@/components/ui/button"
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
      <section className="overflow-hidden rounded-(--nr-radius-card) border border-border/70 bg-card shadow-(--nr-shadow-card)">
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

        <GateNote reason={writeReason} />

        {media.total === 0 ? (
          <PhotosEmpty
            filtersActive={filtersActive}
            disabled={disabled}
            onClearFilters={() =>
              onStateChange({ ownership: "all", category: "all", page: 1 })
            }
            onAdd={() => setAddOpen(true)}
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

function PhotosEmpty({
  filtersActive,
  disabled,
  onClearFilters,
  onAdd,
}: {
  filtersActive: boolean
  disabled: boolean
  onClearFilters: () => void
  onAdd: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ImagesIcon aria-hidden className="size-5" />
      </span>
      <div>
        <h3 className="text-ui font-semibold">
          {filtersActive ? "No matching photos" : "No photos yet"}
        </h3>
        <p className="mt-1 max-w-sm text-caption text-muted-foreground">
          {filtersActive
            ? "Try a different ownership or category filter."
            : "Add high-quality photos to help customers understand what to expect."}
        </p>
      </div>
      {filtersActive ? (
        <Button variant="outline" size="sm" onClick={onClearFilters}>
          Clear filters
        </Button>
      ) : (
        <Button size="sm" disabled={disabled} onClick={onAdd}>
          <PlusIcon aria-hidden data-icon="inline-start" />
          Add photos
        </Button>
      )}
    </div>
  )
}
