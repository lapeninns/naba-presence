"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { AttentionList } from "@/components/home/attention-list"
import { DisconnectedBanner } from "@/components/home/disconnected-banner"
import { HealthKpis } from "@/components/home/health-kpis"
import { PulseChart } from "@/components/home/pulse-chart"
import { SetupChecklistCard } from "@/components/home/setup-checklist-card"
import { WorkByClient } from "@/components/home/work-by-client"
import { WorkQueue } from "@/components/home/work-queue"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"
import { useClients } from "@/lib/queries/use-clients"
import { useReviewCounts } from "@/lib/queries/use-review-counts"
import { useSessionRole } from "@/lib/queries/use-session"

/**
 * The summary: the figures first, the last 30 days as a curve, then the two
 * lists that are today's to-do, and finally the per-client table.
 */
function HomeView() {
  const counts = useReviewCounts()
  const analytics = useAnalyticsOverview()
  const clients = useClients()
  const role = useSessionRole()

  const isPending = counts.isPending || analytics.isPending
  const isError = counts.isError || analytics.isError

  function retry() {
    void counts.refetch()
    void analytics.refetch()
  }

  if (!isPending && isError && !counts.data && !analytics.data) {
    return (
      <div className="flex flex-col gap-(--np-gap-section)">
        <DisconnectedBanner />
        <Alert variant="destructive">
          <AlertTitle>We could not load your home page.</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>Check your connection, then try again.</span>
            <Button variant="outline" size="sm" onClick={retry}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      <SetupChecklistCard role={role} />
      <DisconnectedBanner />
      <HealthKpis summary={analytics.data?.summary} isPending={isPending} />
      <PulseChart
        overview={analytics.data}
        isPending={analytics.isPending}
        isError={analytics.isError}
        onRetry={() => void analytics.refetch()}
      />
      <div className="grid gap-(--np-gap-section) lg:grid-cols-2">
        <WorkQueue
          counts={counts.data}
          unresolvedComplaints={
            analytics.data?.summary.unresolvedComplaints ?? 0
          }
          isPending={isPending}
        />
        <AttentionList
          locations={analytics.data?.locations}
          isPending={analytics.isPending}
          isError={analytics.isError && !analytics.data}
          onRetry={() => void analytics.refetch()}
        />
      </div>
      <WorkByClient
        clients={clients.data?.items}
        isPending={clients.isPending}
      />
    </div>
  )
}

export { HomeView }
