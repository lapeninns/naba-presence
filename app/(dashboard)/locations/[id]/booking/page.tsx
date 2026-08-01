import { BookingTab } from "@/components/locations/booking-tab"

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <BookingTab locationId={id} />
}
