import { HydrationBoundary } from "@tanstack/react-query"

import { AreaFrame } from "@/components/listings/area-frame"
import { AccessTab } from "@/components/locations/administration"
import { listingPagePrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "People with access · Listing · NabaPresence" }

export default async function ListingPeoplePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  const state = await prefetch(session, listingPagePrefetch(id))
  return (
    <HydrationBoundary state={state}>
      <AreaFrame locationId={id} role={session?.role ?? null} area="people">
        <AccessTab locationId={id} />
      </AreaFrame>
    </HydrationBoundary>
  )
}
