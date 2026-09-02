import { HydrationBoundary } from "@tanstack/react-query"

import { PageHeader } from "@/components/app-shell/page-frame"
import { NoLocationEmpty } from "@/components/locations/no-location-empty"
import { MenuTab } from "@/components/locations/menu-tab"
import { locationTabPrefetch, prefetch } from "@/lib/server/prefetch"
import { resolvePrimaryLocation } from "@/lib/server/primary-location"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Menu · NabaPresence" }

export default async function MenuPage() {
  const session = await getSession()
  const { locationId } = await resolvePrimaryLocation()
  const state = await prefetch(
    session,
    locationTabPrefetch(locationId, "menu")
  )
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Menu"
        description="Your food menu on Google."
      />
      {locationId ? (
        <HydrationBoundary state={state}>
          <MenuTab locationId={locationId} />
        </HydrationBoundary>
      ) : (
        <NoLocationEmpty role={session?.role ?? null} />
      )}
    </div>
  )
}
