import { BusinessInformationTab } from "@/components/locations/business-information-tab"

export default async function BusinessInformationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <BusinessInformationTab locationId={id} />
}
