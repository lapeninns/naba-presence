import { LocationBookingView } from "@/components/naba-presence/location-booking-view"

export const metadata = { title: "Booking · NabaPresence" }

export default async function LocationBookingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <LocationBookingView locationId={id} />
}
