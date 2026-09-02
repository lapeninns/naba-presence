import { HydrationBoundary } from "@tanstack/react-query"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/app-shell/page-frame"
import { AdministrationTab } from "@/components/locations/administration-tab"
import { NoLocationEmpty } from "@/components/locations/no-location-empty"
import { locationTabPrefetch, prefetch } from "@/lib/server/prefetch"
import { resolvePrimaryLocation } from "@/lib/server/primary-location"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Google listing · NabaPresence" }

// Administration lives under Settings, not Business profile: it manages who
// can edit the listing on Google, verification state, and a danger zone that
// can transfer or delete the location. That is access control plus destructive
// operations — the same shape as Team and Connections — and putting a delete
// control next to the copy-editing screens would be a safety mismatch.
export default async function SettingsListingPage() {
  const session = await getSession()
  // Matches AdministrationTab's own canEditCanonical gate and the owner/admin
  // gate on GET /api/locations/[id]/administration, so there is no reachable
  // 403 here.
  if (!session || (session.role !== "owner" && session.role !== "admin")) {
    redirect("/settings")
  }
  const { locationId, locationName } = await resolvePrimaryLocation()
  const state = await prefetch(
    session,
    locationTabPrefetch(locationId, "administration")
  )
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Google listing"
        description="Who can manage this business on Google, how it is verified, and advanced listing actions."
      />
      {locationId ? (
        <HydrationBoundary state={state}>
          <AdministrationTab
            locationId={locationId}
            locationName={locationName ?? undefined}
          />
        </HydrationBoundary>
      ) : (
        <NoLocationEmpty role={session.role} />
      )}
    </div>
  )
}
