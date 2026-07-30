import { PerformanceView } from "@/components/naba-presence/performance-view"
import { getServerEnv } from "@/lib/server/env"

export const metadata = { title: "Performance · NabaPresence" }

export default function PerformancePage() {
  return (
    <PerformanceView
      googlePerformanceEnabled={getServerEnv().GBP_PERFORMANCE_ENABLED}
    />
  )
}
