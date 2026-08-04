import { PageHeader } from "@/components/app-shell/page-frame"
import { NoLocationEmpty } from "@/components/locations/no-location-empty"
import { BusinessInformationTab } from "@/components/locations/business-information-tab"
import { resolvePrimaryLocation } from "@/lib/server/primary-location"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Business details · NabaPresence" }

export default async function BusinessInformationPage() {
  const session = await getSession()
  const { locationId } = await resolvePrimaryLocation()
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Business details"
        description="Categories, attributes and how your business is described."
      />
      {locationId ? (
        <BusinessInformationTab locationId={locationId} />
      ) : (
        <NoLocationEmpty role={session?.role ?? null} />
      )}
    </div>
  )
}
