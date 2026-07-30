import { PerformanceView } from "@/components/naba-presence/performance-view"

export const metadata = { title: "Performance · NabaPresence" }

export default function PerformancePage() {
  return <PerformanceView googlePerformanceEnabled={false} />
}
