import { HydrationBoundary } from "@tanstack/react-query"

import { AreaFrame } from "@/components/listings/area-frame"
import { StreamedTab } from "@/components/listings/streamed-tab"
import { PhotosTab } from "@/components/locations/photos-tab"
import { listingPageMetadata } from "@/lib/server/listing-metadata"
import {
  listingPagePrefetch,
  photosTabPrefetch,
  prefetch,
} from "@/lib/server/prefetch"
import { requestSearch } from "@/lib/server/request-search"
import { getSession } from "@/lib/server/session"

/** The venue's name in the tab title, from one DB row; never Google. */
export function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return listingPageMetadata(params, "Photos")
}

// The capabilities and DB summary are awaited (pure SQL, so the header and
// status paint at once); the editor's own first read reaches Google and is
// streamed behind the tab's pending state (components/listings/streamed-tab.tsx).
//
// The filters come from the request's query string (proxy.ts's header), not
// a `searchParams` prop, as on the inbox: the prefetch keys the first page by
// them, and the tab keeps reading its filters from the URL itself.
export default async function ListingPhotosPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session, search] = await Promise.all([
    params,
    getSession(),
    requestSearch(),
  ])
  const state = await prefetch(session, listingPagePrefetch(id))
  return (
    <HydrationBoundary state={state}>
      <AreaFrame locationId={id} role={session?.role ?? null} area="photos">
        <StreamedTab
          session={session}
          entries={photosTabPrefetch(id, search)}
          loadingLabel="photos"
        >
          <PhotosTab locationId={id} />
        </StreamedTab>
      </AreaFrame>
    </HydrationBoundary>
  )
}
