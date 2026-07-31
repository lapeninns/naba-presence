import { LocationMenuView } from "@/components/naba-presence/location-menu-view"

export const metadata = { title: "Menu · NabaPresence" }

export default async function LocationMenuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <LocationMenuView locationId={id} />
}
