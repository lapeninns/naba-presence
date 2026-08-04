import { PageHeader } from "@/components/app-shell/page-frame"
import { NoLocationEmpty } from "@/components/locations/no-location-empty"
import { PhotosTab } from "@/components/locations/photos-tab"
import { resolvePrimaryLocation } from "@/lib/server/primary-location"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Photos · NabaPresence" }

// No PageFrame here — (business)/layout.tsx owns the <main>. resolvePrimary-
// Location is React.cache()'d, so this shares the layout's single query.
export default async function PhotosPage() {
  const session = await getSession()
  const { locationId } = await resolvePrimaryLocation()
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Photos"
        description="The photos customers see on your Google listing."
      />
      {locationId ? (
        <PhotosTab locationId={locationId} />
      ) : (
        <NoLocationEmpty role={session?.role ?? null} />
      )}
    </div>
  )
}
