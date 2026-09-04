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
      <div className="flex flex-col gap-6">
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
    <div className="flex flex-col gap-8">
      <SetupChecklistCard role={role} />
      <DisconnectedBanner />
      <WorkQueue
        counts={counts.data}
        unresolvedComplaints={
          analytics.data?.summary.unresolvedComplaints ?? 0
        }
        isPending={isPending}
      />
      <WorkByClient clients={clients.data?.items} isPending={clients.isPending} />
      <HealthKpis summary={analytics.data?.summary} isPending={isPending} />
      <PulseChart
        overview={analytics.data}
        isPending={analytics.isPending}
        isError={analytics.isError}
        onRetry={() => void analytics.refetch()}
      />
      <AttentionList
        locations={analytics.data?.locations}
        isPending={analytics.isPending}
        isError={analytics.isError && !analytics.data}
        onRetry={() => void analytics.refetch()}
      />
    </div>
  )
}

export { HomeView }
