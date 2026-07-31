import { LocationBusinessInformationView } from "@/components/naba-presence/location-business-information-view"

export const metadata = { title: "Business information · NabaPresence" }

export default async function LocationBusinessInformationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <LocationBusinessInformationView locationId={id} />
}
