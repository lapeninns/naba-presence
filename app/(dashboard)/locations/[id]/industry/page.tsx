import { LocationIndustryView } from "@/components/naba-presence/location-industry-view"

export const metadata = { title: "Industry management · NabaPresence" }

export default async function LocationIndustryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <LocationIndustryView locationId={id} />
}
