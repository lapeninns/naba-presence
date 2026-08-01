"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatNumber, formatPercent } from "@/lib/format"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"
import { useReviewCounts } from "@/lib/queries/use-review-counts"

// Baseline definition of "needs attention": reviews still awaiting a human.
// Deliberately conservative; the owner or the Inbox milestone (M4) may refine
// which workflow states belong here.
const NEEDS_ATTENTION_STATES = ["new", "escalated", "failed"] as const

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1">
        <p className="text-ui text-muted-foreground">{label}</p>
        <p className="text-page-title font-semibold tracking-tight tabular-nums">
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

function KpiCards() {
  const counts = useReviewCounts()
  const analytics = useAnalyticsOverview()

  if (counts.isPending || analytics.isPending) {
    return (
      <div
        aria-busy="true"
        className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4"
      >
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-28 rounded-(--nr-radius-card)" />
        ))}
      </div>
    )
  }

  if (counts.isError || analytics.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>We could not load your Home summary.</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          <span>Check your connection, then try again.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void counts.refetch()
              void analytics.refetch()
            }}
          >
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const needsAttention = NEEDS_ATTENTION_STATES.reduce(
    (total, state) => total + (counts.data.byStatus[state] ?? 0),
    0
  )
  const { averageRating, responseRate } = analytics.data.summary

  return (
    <div className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Total reviews" value={formatNumber(counts.data.total)} />
      <KpiCard label="Needs attention" value={formatNumber(needsAttention)} />
      <KpiCard
        label="Average rating"
        value={averageRating === null ? "—" : averageRating.toFixed(1)}
      />
      <KpiCard
        label="Response rate"
        value={responseRate === null ? "—" : formatPercent(responseRate)}
      />
    </div>
  )
}

export { KpiCards, NEEDS_ATTENTION_STATES }
