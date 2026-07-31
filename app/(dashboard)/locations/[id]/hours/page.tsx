import { LocationHoursView } from "@/components/naba-presence/location-hours-view"

export const metadata = { title: "Hours · NabaPresence" }

export default async function LocationHoursPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <LocationHoursView locationId={id} />
}
