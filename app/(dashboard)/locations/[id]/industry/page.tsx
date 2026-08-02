import { IndustryTab } from "@/components/locations/industry-tab"

export default async function IndustryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <IndustryTab locationId={id} />
}
