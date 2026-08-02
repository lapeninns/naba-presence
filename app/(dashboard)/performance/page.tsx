import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { PerformanceView } from "@/components/performance/performance-view"

export const metadata = { title: "Performance · NabaPresence" }

export default function PerformancePage() {
  return (
    <PageFrame width="wide">
      <PageHeader
        title="Performance"
        description="How your locations are performing on Google — replies, visibility, and search keywords."
      />
      <PerformanceView />
    </PageFrame>
  )
}
