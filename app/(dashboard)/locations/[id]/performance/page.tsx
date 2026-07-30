import { CapabilityPlaceholder } from "@/components/naba-presence/capability-placeholder"
import { getServerEnv } from "@/lib/server/env"

export const metadata = { title: "Performance · NabaPresence" }

export default function LocationPerformancePage() {
  return (
    <CapabilityPlaceholder
      capability="Performance"
      flag="GBP_PERFORMANCE_ENABLED"
      enabled={getServerEnv().GBP_PERFORMANCE_ENABLED}
      description="Impressions, searches, calls, direction requests, and website clicks for this location."
    />
  )
}
