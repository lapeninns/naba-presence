import { HydrationBoundary } from "@tanstack/react-query"

import { PageHeader } from "@/components/app-shell/page-frame"
import { NoLocationEmpty } from "@/components/locations/no-location-empty"
import { HoursTab } from "@/components/locations/hours-tab"
import { locationTabPrefetch, prefetch } from "@/lib/server/prefetch"
import { resolvePrimaryLocation } from "@/lib/server/primary-location"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Opening hours · NabaPresence" }

export default async function HoursPage() {
  const session = await getSession()
  const { locationId } = await resolvePrimaryLocation()
  const state = await prefetch(
    session,
    locationTabPrefetch(locationId, "hours")
  )
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Opening hours"
        description="Regular and special hours, kept in sync with Google."
      />
      {locationId ? (
        <HydrationBoundary state={state}>
          <HoursTab locationId={locationId} />
        </HydrationBoundary>
      ) : (
        <NoLocationEmpty role={session?.role ?? null} />
      )}
    </div>
  )
}
