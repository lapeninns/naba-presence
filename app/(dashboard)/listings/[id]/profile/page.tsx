import { HydrationBoundary } from "@tanstack/react-query"

import { AreaFrame } from "@/components/listings/area-frame"
import { ProfileTab } from "@/components/locations/profile/profile-editor"
import { listingPageMetadata } from "@/lib/server/listing-metadata"
import { listingPagePrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

/** The venue's name in the tab title, from one DB row; never Google. */
export function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return listingPageMetadata(params, "Business profile")
}

export default async function ListingProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  const state = await prefetch(session, listingPagePrefetch(id))
  return (
    <HydrationBoundary state={state}>
      <AreaFrame locationId={id} role={session?.role ?? null} area="profile">
        <ProfileTab locationId={id} />
      </AreaFrame>
    </HydrationBoundary>
  )
}
