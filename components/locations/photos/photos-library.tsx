"use client"

import { useQueryClient } from "@tanstack/react-query"
import { FilterIcon, ImagesIcon, PlusIcon } from "lucide-react"
import dynamic from "next/dynamic"
import { useRef, useState } from "react"

import { EditorFrame } from "@/components/editors/editor-frame"
import { PhotosGrid } from "@/components/locations/photos/photos-grid"
import { PhotosToolbar } from "@/components/locations/photos/photos-toolbar"
import { UnresolvedCreates } from "@/components/locations/photos/unresolved-creates"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { fetchMedia, type MediaState } from "@/lib/api/location-media"
import { formatNumber } from "@/lib/format/number"
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
import { cn } from "@/lib/utils"

// The add dialog (uploads, drag and drop, the review step) loads the first
// time it opens: most visits to the library only browse.
const AddPhotoDialog = dynamic(
  () =>
    import("@/components/locations/photos/add-photo-dialog").then(
      (m) => m.AddPhotoDialog
    ),
  { ssr: false }
)

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
  // Mounted from the first open on, so it keeps its state and closes
  // through its own animation like any other dialog.
  const [addMounted, setAddMounted] = useState(false)
  if (addOpen && !addMounted) setAddMounted(true)
  const disabled = Boolean(writeReason)
  const query = toMediaQuery(state)
  const filtersActive = hasActivePhotoFilters(state)
  const addRef = useRef<HTMLButtonElement | null>(null)
  // The grid on screen is still the last filter's while the new one loads
  // (it is kept rather than dropped to a skeleton). The server echoes the
  // filters it answered for, so a mismatch says the grid is out of date:
  // it is dimmed and inert, and nothing can be changed from a list the
  // filters no longer describe.
  const settling =
    (media.category !== undefined || media.ownership !== undefined) &&
    ((media.category ?? null) !== query.category ||
      (media.ownership ?? null) !== query.ownership)

  // Re-read the first page straight from Google and seed this view with it
  // alone (the pages loaded after it may have moved), then drop every other
  // filter of this location's media so they refetch on demand.
  //
  // Only the toolbar's own Refresh says it ran: after an add, a delete or a
  // resolution that write's own toast already speaks, and a second one
  // would only repeat it.
  const refresh = useResourceMutation<MediaState, { announce: boolean }>({
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
    successToast: (fresh, { announce }) => {
      if (!announce) return null
      const matching = filtersActive ? "matching " : ""
      if (fresh.total === 0)
        return filtersActive
          ? "Refreshed from Google: no matching photos"
          : "Refreshed from Google: no photos yet"
      return `Refreshed from Google: ${formatNumber(fresh.total)} ${matching}${fresh.total === 1 ? "item" : "items"}`
    },
  })
  const refreshFromGoogle = () => refresh.mutate({ announce: false })

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
          onRefresh={() => refresh.mutate({ announce: true })}
          action={
            <Button
              ref={addRef}
              disabled={disabled}
              onClick={() => setAddOpen(true)}
            >
              <PlusIcon aria-hidden />
              Add photos
            </Button>
          }
        />

        {/* Always mounted, so the words are announced when they arrive. */}
        <p
          role="status"
          className={cn("text-caption text-ink-muted", !settling && "sr-only")}
        >
          {settling ? "Loading matching photos…" : null}
        </p>
        <div
          aria-busy={settling || undefined}
          // Keyboard and screen readers can't act on the old grid either.
          inert={settling || undefined}
          className={cn(
            "flex flex-col gap-4 transition-opacity duration-(--np-duration-fast) motion-reduce:transition-none",
            settling && "pointer-events-none opacity-60"
          )}
        >
          {media.total === 0 ? (
            <PhotosEmpty
              filtersActive={filtersActive}
              canAdd={!disabled}
              onClearFilters={() =>
                onStateChange({ ownership: "all", category: "all" })
              }
            />
          ) : (
            <PhotosGrid
              locationId={locationId}
              items={media.items}
              patchCategories={media.categories.filter(
                isPatchableMediaCategory
              )}
              total={media.total}
              paging={media.paging}
              disabled={disabled}
              writeReason={writeReason}
              refreshing={refresh.isPending}
              fallbackFocusRef={addRef}
              onChanged={refreshFromGoogle}
            />
          )}
        </div>
      </div>

      {addMounted ? (
        <AddPhotoDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          locationId={locationId}
          categories={media.categories}
          writeReason={writeReason}
          onAdded={refreshFromGoogle}
        />
      ) : null}
    </EditorFrame>
  )
}

// No "Add photos" action here on purpose: the browse row always renders one,
// wired to the same handler. Offering it twice on one screen gave the same
// action two accessible names in the same view. The copy names it rather
// than pointing "above", and only to someone who can add.
//
// The filtered state replaces the grid because a filter just changed, so it
// is announced (`role="status"`); Clear filters sits outside that region.
function PhotosEmpty({
  filtersActive,
  canAdd,
  onClearFilters,
}: {
  filtersActive: boolean
  canAdd: boolean
  onClearFilters: () => void
}) {
  return (
    <Empty
      variant="empty"
      framed
      icon={filtersActive ? <FilterIcon /> : <ImagesIcon />}
      titleAs="h3"
      title={filtersActive ? "No matching photos" : "No photos yet"}
      role={filtersActive ? "status" : undefined}
      description={
        filtersActive
          ? "Nothing here matches these filters. Try another ownership or category, or clear them."
          : canAdd
            ? "Google has no photos for this listing yet. Use Add photos to upload the first ones, or Refresh from Google if someone added them on Google directly."
            : "Google has no photos for this listing yet. Refresh from Google if someone added them on Google directly."
      }
      actions={
        filtersActive ? (
          <Button variant="secondary" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  )
}
