import { PageFrame } from "@/components/app-shell/page-frame"
import { PerformanceView } from "@/components/performance/performance-view"
import { ViewHeader } from "@/components/ui/view-header"

import { resolveTabRange } from "@/lib/reporting/ranges"
import { HydrationBoundary } from "@/lib/queries/hydration-boundary"
import { prefetch } from "@/lib/server/prefetch"
import { replyReportPrefetch } from "@/lib/server/reports-prefetch"
import { getSession } from "@/lib/server/session"
import { workspaceTerms } from "@/lib/workspace/terms"
import { z } from "zod"

export const metadata = { title: "Reports · NabaPresence" }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const session = await getSession()
  const terms = workspaceTerms(session?.workspaceMode ?? "agency")
  const params = await searchParams

  // The Reply tab is what opens by default, so its two overview reads are
  // made here, on the server, for exactly the report the address asks for
  // (PerformanceView reads the same parameters): not for the Google or
  // Keywords tabs, and not for a single listing's report. A business ignores
  // a stale `?clientId=`, as the view does.
  const tab = one(params.tab)
  const replyTab = tab !== "google" && tab !== "keywords"
  const clientParam =
    session?.workspaceMode === "business" ? undefined : one(params.clientId)
  const clientId = z.uuid().safeParse(clientParam).success
    ? clientParam
    : undefined
  const prefetchable =
    Boolean(session) &&
    replyTab &&
    !one(params.locationId) &&
    (clientParam === undefined || clientId !== undefined)
  const now = new Date()
  // One tree whatever the address: switching tab or period re-renders this
  // page on the server, and a different wrapper here would remount the view.
  const state = await prefetch(
    session,
    prefetchable
      ? replyReportPrefetch({
          rangeId: resolveTabRange("reply", {
            range: one(params.range) ?? null,
            rangeKw: one(params.range_kw) ?? null,
          }).id,
          clientId,
          now,
        })
      : []
  )

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
      <HydrationBoundary state={state}>
        <PerformanceView windowNow={now.toISOString()} />
      </HydrationBoundary>
    </PageFrame>
  )
}
