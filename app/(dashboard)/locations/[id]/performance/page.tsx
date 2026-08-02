import { LocationPerformance } from "@/components/performance/location-performance"

export const metadata = { title: "Performance · Location · NabaPresence" }

export default async function LocationPerformancePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <LocationPerformance locationId={id} />
}
