import { HydrationBoundary } from "@tanstack/react-query"

import { AreaFrame } from "@/components/listings/area-frame"
import { HoursTab } from "@/components/locations/hours-tab"
import { listingPageMetadata } from "@/lib/server/listing-metadata"
import { listingPagePrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

/** The venue's name in the tab title, from one DB row; never Google. */
export function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return listingPageMetadata(params, "Opening hours")
}

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
        <HoursTab locationId={id} />
      </AreaFrame>
    </HydrationBoundary>
  )
}
