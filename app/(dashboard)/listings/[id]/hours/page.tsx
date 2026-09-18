import { HydrationBoundary } from "@tanstack/react-query"

import { AreaFrame } from "@/components/listings/area-frame"
import { HoursTab } from "@/components/locations/hours-tab"
import { listingPagePrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Opening hours · Listing · NabaPresence" }

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
