"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useMemo } from "react"

import { LocationTab } from "@/components/locations/location-tab"
import { PhotosLibrary } from "@/components/locations/photos/photos-library"
import {
  parsePhotosState,
  serializePhotosState,
  toMediaQuery,
  type PhotosState,
} from "@/lib/locations/photos-url-state"
import { DEFAULT_MEDIA_PAGE_SIZE } from "@/lib/media-page"
import { useMedia } from "@/lib/queries/use-location-media"

// The vocabulary helpers used to live here; keep the import path stable.
export {
  humaniseCategory,
  isPatchableMediaCategory,
  PATCHABLE_MEDIA_CATEGORIES,
} from "@/lib/locations/media-labels"

/** Page + browse filters, read from the URL (`?page=2&ownership=customer&category=INTERIOR`). */
function usePhotosUrlState(): PhotosState {
  const searchParams = useSearchParams()
  return useMemo(
    () => parsePhotosState(new URLSearchParams(searchParams.toString())),
    [searchParams]
  )
}

// The shell's resource hook must be a module-level function with a stable
// hook order. It reads the page/filters from the URL itself rather than
// closing over component state, so its identity never changes.
function useMediaPage(locationId: string) {
  const state = usePhotosUrlState()
  return useMedia(locationId, {
    ...toMediaQuery(state),
    pageSize: DEFAULT_MEDIA_PAGE_SIZE,
  })
}

export function PhotosTab({ locationId }: { locationId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const state = usePhotosUrlState()

  // Filters and paging use replace (no history spam) and drop defaults from
  // the URL, so `/photos` stays the canonical form of the default view.
  const updateState = useCallback(
    (partial: Partial<PhotosState>) => {
      const next = serializePhotosState(
        { ...state, ...partial },
        new URLSearchParams(searchParams.toString())
      )
      const query = next.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      })
    },
    [pathname, router, searchParams, state]
  )

  return (
    <LocationTab
      locationId={locationId}
      useResource={useMediaPage}
      resource="photos"
    >
      {({ data: media, publishReason }) => (
        <PhotosLibrary
          locationId={locationId}
          media={media}
          state={state}
          onStateChange={updateState}
          writeReason={publishReason}
        />
      )}
    </LocationTab>
  )
}
