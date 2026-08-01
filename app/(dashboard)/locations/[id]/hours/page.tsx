import { HoursTab } from "@/components/locations/hours-tab"

export default async function HoursPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <HoursTab locationId={id} />
}
