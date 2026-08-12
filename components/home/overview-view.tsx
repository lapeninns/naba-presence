"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { AttentionList } from "@/components/home/attention-list"
import { DisconnectedBanner } from "@/components/home/disconnected-banner"
import { HealthKpis } from "@/components/home/health-kpis"
import { PulseChart } from "@/components/home/pulse-chart"
import { WorkQueue } from "@/components/home/work-queue"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"
import { useReviewCounts } from "@/lib/queries/use-review-counts"

function OverviewView() {
  const counts = useReviewCounts()
  const analytics = useAnalyticsOverview()

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
          <AlertTitle>We could not load your Overview.</AlertTitle>
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
      <DisconnectedBanner />
      <WorkQueue
        byStatus={counts.data?.byStatus ?? {}}
        total={counts.data?.total ?? 0}
        unresolvedComplaints={
          analytics.data?.summary.unresolvedComplaints ?? 0
        }
        isPending={isPending}
      />
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

export { OverviewView }
