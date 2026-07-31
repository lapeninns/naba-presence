import { LocationAdministrationView } from "@/components/naba-presence/location-administration-view"

export const metadata = { title: "Google administration · NabaPresence" }

export default async function LocationAdministrationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <LocationAdministrationView locationId={id} />
}
