"use client"

import { useQueryClient } from "@tanstack/react-query"
import { FilterIcon, ImagesIcon, PlusIcon } from "lucide-react"
import { useState } from "react"

import { EditorFrame } from "@/components/editors/editor-frame"
import { AddPhotoDialog } from "@/components/locations/photos/add-photo-dialog"
import { PhotosGrid } from "@/components/locations/photos/photos-grid"
import { PhotosToolbar } from "@/components/locations/photos/photos-toolbar"
import { UnresolvedCreates } from "@/components/locations/photos/unresolved-creates"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { fetchMedia, type MediaState } from "@/lib/api/location-media"
import type { ListPaging } from "@/lib/queries/paged-list"
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
 * The loaded photos tab (reference `listing-photos.html`): the Add action,
 * the capability banner, the browse row, then the gallery or an empty
 * state, and the add-media dialog.
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
  /** Every page loaded so far, merged, and how to load the next. */
  media: MediaState & { paging: ListPaging }
  state: PhotosState
  onStateChange: (partial: Partial<PhotosState>) => void
  writeReason: string | null
}) {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const disabled = Boolean(writeReason)
  const query = toMediaQuery(state)
  const filtersActive = hasActivePhotoFilters(state)

  // Re-read the first page straight from Google and seed this view with it
  // alone (the pages loaded after it may have moved), then drop every other
  // filter of this location's media so they refetch on demand.
  const refresh = useResourceMutation<MediaState>({
    mutationFn: () =>
      fetchMedia(locationId, {
        pageSize: DEFAULT_MEDIA_PAGE_SIZE,
        refresh: true,
        category: query.category ?? undefined,
        ownership: query.ownership ?? undefined,
      }),
    onSuccess: (fresh) => {
      queryClient.setQueryData(
        queryKeys.locationMedia(locationId, {
          category: query.category,
          ownership: query.ownership,
        }),
        { pages: [fresh], pageParams: [null] }
      )
    },
    invalidate: [queryKeys.locationMediaAll(locationId)],
  })
  const refreshFromGoogle = () => refresh.mutate()

  // Inside the listing area the header above already carries the "Photos"
  // h1, the status pill and the model note ("Changes here go to Google
  // straight away."), so the frame keeps its title for the outline only and
  // repeats none of them. The one primary, "Add photos", trails the browse
  // row (Notion Mail's toolbar) rather than sitting in a head row of its own.
  return (
    <EditorFrame
      title="Photo library"
      titleHidden
      gateReason={writeReason}
      gateTitle="You can look, but not change these photos"
    >
      <div className="flex flex-col gap-4">
        <UnresolvedCreates
          locationId={locationId}
          creates={media.unresolvedCreates}
          canResolve={media.canPublish}
          onResolved={refreshFromGoogle}
        />
        <PhotosToolbar
          categories={media.categories}
          state={state}
          onStateChange={onStateChange}
          refreshing={refresh.isPending}
          onRefresh={refreshFromGoogle}
          action={
            <Button disabled={disabled} onClick={() => setAddOpen(true)}>
              <PlusIcon aria-hidden />
              Add photos
            </Button>
          }
        />

        {media.total === 0 ? (
          <PhotosEmpty
            filtersActive={filtersActive}
            onClearFilters={() =>
              onStateChange({ ownership: "all", category: "all" })
            }
          />
        ) : (
          <PhotosGrid
            locationId={locationId}
            items={media.items}
            patchCategories={media.categories.filter(isPatchableMediaCategory)}
            total={media.total}
            paging={media.paging}
            disabled={disabled}
            writeReason={writeReason}
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

// No "Add photos" action here on purpose: the browse row directly above always
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
      variant="empty"
      framed
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
