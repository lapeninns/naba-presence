import { LocationPhotosView } from "@/components/naba-presence/location-photos-view"

export const metadata = { title: "Photos · NabaPresence" }

export default async function LocationPhotosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <LocationPhotosView locationId={id} />
}
