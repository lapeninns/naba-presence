import { HydrationBoundary } from "@tanstack/react-query"

import { AreaFrame } from "@/components/listings/area-frame"
import { StreamedTab } from "@/components/listings/streamed-tab"
import { HoursTab } from "@/components/locations/hours-tab"
import { listingPageMetadata } from "@/lib/server/listing-metadata"
import {
  hoursTabPrefetch,
  listingPagePrefetch,
  prefetch,
} from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

/** The venue's name in the tab title, from one DB row; never Google. */
export function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return listingPageMetadata(params, "Opening hours")
}

// The capabilities and DB summary are awaited (pure SQL, so the header and
// status paint at once); the editor's own first read reaches Google and is
// streamed behind the tab's pending state (components/listings/streamed-tab.tsx).
export default async function ListingHoursPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  const state = await prefetch(session, listingPagePrefetch(id))
  return (
    <HydrationBoundary state={state}>
      <AreaFrame locationId={id} role={session?.role ?? null} area="hours">
        <StreamedTab
          session={session}
          entries={hoursTabPrefetch(id)}
          loadingLabel="opening hours"
        >
          <HoursTab locationId={id} />
        </StreamedTab>
      </AreaFrame>
    </HydrationBoundary>
  )
}
