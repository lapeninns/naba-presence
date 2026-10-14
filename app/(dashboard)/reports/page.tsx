import { PageFrame } from "@/components/app-shell/page-frame"
import { PerformanceView } from "@/components/performance/performance-view"
import { ViewHeader } from "@/components/ui/view-header"

import { getSession } from "@/lib/server/session"
import { workspaceTerms } from "@/lib/workspace/terms"

export const metadata = { title: "Reports · NabaPresence" }

export default async function ReportsPage() {
  const session = await getSession()
  const terms = workspaceTerms(session?.workspaceMode ?? "agency")
  return (
    <PageFrame width="wide">
      {/* The page's one h1, server-rendered so it is there before the report
          streams in. The scope is NOT a header action here: it is three
          fields and Share report on a desk and a wrapping summary pill on a
          phone, and the header's action slot keeps its content at full
          width (it never shrinks), so the scope stays the row directly
          under the title (ReportToolbar, in PerformanceView). */}
      <div className="flex flex-col gap-1">
        <ViewHeader title="Reports" />
        <p className="max-w-prose text-body text-pretty text-ink-muted">
          {terms.reportsDescription}
        </p>
      </div>
      <PerformanceView />
    </PageFrame>
  )
}
