import { PresenceAnalyticsView } from "@/components/naba-presence/presence-analytics-view"

export const metadata = { title: "Performance · NabaPresence" }

export default async function LocationPerformancePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <PresenceAnalyticsView locationId={id} />
}
