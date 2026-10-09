import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { PerformanceView } from "@/components/performance/performance-view"

import { getSession } from "@/lib/server/session"
import { workspaceTerms } from "@/lib/workspace/terms"

export const metadata = { title: "Reports · NabaPresence" }

export default async function ReportsPage() {
  const session = await getSession()
  const terms = workspaceTerms(session?.workspaceMode ?? "agency")
  return (
    <PageFrame width="wide">
      <PageHeader
        title="Reports"
        description={terms.reportsDescription}
      />
      <PerformanceView />
    </PageFrame>
  )
}
