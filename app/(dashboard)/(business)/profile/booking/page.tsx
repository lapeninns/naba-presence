import { PageHeader } from "@/components/app-shell/page-frame"
import { NoLocationEmpty } from "@/components/locations/no-location-empty"
import { BookingTab } from "@/components/locations/booking-tab"
import { resolvePrimaryLocation } from "@/lib/server/primary-location"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Booking links · NabaPresence" }

export default async function BookingPage() {
  const session = await getSession()
  const { locationId } = await resolvePrimaryLocation()
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Booking links"
        description="Where customers can book, order or make an appointment."
      />
      {locationId ? (
        <BookingTab locationId={locationId} />
      ) : (
        <NoLocationEmpty role={session?.role ?? null} />
      )}
    </div>
  )
}
