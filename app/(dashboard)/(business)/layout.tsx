import { PageFrame } from "@/components/app-shell/page-frame"
import { LocationContextBar } from "@/components/locations/location-context-bar"
import { resolvePrimaryLocation } from "@/lib/server/primary-location"

// This layout owns the ONLY <main> for the whole flat-business surface. The
// (business) group adds no URL segment — /photos, /posts and /profile are the
// real paths — it exists so a single file is responsible for the landmark
// rather than every page author having to remember not to add one.
//
// width="wide" matches /home and /performance, and gives the photos grid and
// the business-information forms the room they were laid out for.
export default async function BusinessLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { locationName, locationCount } = await resolvePrimaryLocation()
  return (
    <PageFrame width="wide">
      {locationName ? (
        <LocationContextBar
          locationName={locationName}
          locationCount={locationCount}
        />
      ) : null}
      {children}
    </PageFrame>
  )
}
