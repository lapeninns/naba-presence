import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { PerformanceView } from "@/components/performance/performance-view"

export const metadata = { title: "Reports · NabaPresence" }

export default function ReportsPage() {
  return (
    <PageFrame width="wide">
      <PageHeader
        title="Reports"
        description="How your clients are performing on Google — replies, visibility and search keywords."
      />
      <PerformanceView />
    </PageFrame>
  )
}
