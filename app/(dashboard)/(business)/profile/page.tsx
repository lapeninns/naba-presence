import { HydrationBoundary } from "@tanstack/react-query"
import Link from "next/link"

import { PageHeader } from "@/components/app-shell/page-frame"
import { NoLocationEmpty } from "@/components/locations/no-location-empty"
import { ProfileTab } from "@/components/locations/profile-tab"
import { locationTabPrefetch, prefetch } from "@/lib/server/prefetch"
import { resolvePrimaryLocation } from "@/lib/server/primary-location"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Business profile · NabaPresence" }

export default async function ProfilePage() {
  const session = await getSession()
  const { locationId } = await resolvePrimaryLocation()
  const state = await prefetch(session, locationTabPrefetch(locationId))
  const canManageListing =
    session?.role === "owner" || session?.role === "admin"
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Business profile"
        description="Your name, description and contact details as they appear on Google."
      />
      {locationId ? (
        <>
          <HydrationBoundary state={state}>
            <ProfileTab locationId={locationId} />
          </HydrationBoundary>
          {/* Administration lives under Settings (access control + danger
              zone, not content), so signpost it from the page an owner
              searching for "who can edit my listing" would try first. */}
          {canManageListing ? (
            <p className="text-ui text-muted-foreground">
              Manage who can edit this business on Google, and how it is
              verified, in{" "}
              <Link
                href="/settings/listing"
                className="font-medium underline underline-offset-4"
              >
                Settings › Listing
              </Link>
              .
            </p>
          ) : null}
        </>
      ) : (
        <NoLocationEmpty role={session?.role ?? null} />
      )}
    </div>
  )
}
