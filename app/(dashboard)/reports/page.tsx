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
          streams in. The scope is NOT a header action here: on a desk it is
          three fields in the row under the title (ReportToolbar, in
          PerformanceView), and on a phone it is the app bar's scope chip.
          The description is for a desk: on a phone it would sit between the
          title and the first figure. */}
      <div className="flex flex-col gap-1">
        <ViewHeader title="Reports" />
        <p className="hidden max-w-prose text-body text-pretty text-ink-muted md:block">
          {terms.reportsDescription}
        </p>
      </div>
      <PerformanceView />
    </PageFrame>
  )
}
