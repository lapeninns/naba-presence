import { LocationProfileView } from "@/components/naba-presence/location-profile-view"

export const metadata = { title: "Location profile · NabaPresence" }

export default async function LocationProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <LocationProfileView locationId={id} />
}
