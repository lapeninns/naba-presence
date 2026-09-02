import { HydrationBoundary } from "@tanstack/react-query"

import { PageHeader } from "@/components/app-shell/page-frame"
import { NoLocationEmpty } from "@/components/locations/no-location-empty"
import { PhotosTab } from "@/components/locations/photos-tab"
import { locationTabPrefetch, prefetch } from "@/lib/server/prefetch"
import { resolvePrimaryLocation } from "@/lib/server/primary-location"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Photos · NabaPresence" }

// No PageFrame here — (business)/layout.tsx owns the <main>. resolvePrimary-
// Location is React.cache()'d, so this shares the layout's single query.
export default async function PhotosPage() {
  const [session, { locationId }] = await Promise.all([
    getSession(),
    resolvePrimaryLocation(),
  ])
  const state = await prefetch(
    session,
    locationTabPrefetch(locationId, "photos")
  )
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Photos"
        description="The photos and videos customers see on your Google listing."
      />
      {locationId ? (
        <HydrationBoundary state={state}>
          <PhotosTab locationId={locationId} />
        </HydrationBoundary>
      ) : (
        <NoLocationEmpty role={session?.role ?? null} />
      )}
    </div>
  )
}
