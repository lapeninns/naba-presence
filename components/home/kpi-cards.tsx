"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatTile } from "@/components/reporting/stat-tile"
import { formatDuration, formatNumber, formatPercent } from "@/lib/format"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"
import { useReviewCounts } from "@/lib/queries/use-review-counts"

// Baseline definition of "needs attention": reviews still awaiting a human.
// Deliberately conservative; the owner or the Inbox milestone (M4) may refine
// which workflow states belong here.
const NEEDS_ATTENTION_STATES = ["new", "escalated", "failed"] as const

function KpiCards() {
  const counts = useReviewCounts()
  const analytics = useAnalyticsOverview()

  if (counts.isPending || analytics.isPending) {
    return (
      <div
        aria-busy="true"
        className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4"
      >
        {[0, 1, 2, 3, 4, 5].map((index) => (
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
  const s = analytics.data.summary

  return (
    <div className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4">
      <StatTile label="Total reviews" value={formatNumber(counts.data.total)} />
      <StatTile label="Needs attention" value={formatNumber(needsAttention)} />
      <StatTile label="Average rating" value={s.averageRating === null ? "—" : s.averageRating.toFixed(1)} />
      <StatTile label="Response rate" value={s.responseRate === null ? "—" : formatPercent(s.responseRate)} />
      <StatTile label="Median response time" value={formatDuration(s.medianFirstResponseSeconds)} hint="First reply, last 30 days" />
      <StatTile label="Unresolved complaints" value={formatNumber(s.unresolvedComplaints)} hint="1–2 star, no published reply" />
      <StatTile
        label="Verification rejections"
        value={s.verificationRejectionRate === null ? "—" : formatPercent(s.verificationRejectionRate)}
        hint={`${formatNumber(s.verificationFailures)} rejected`}
      />
    </div>
  )
}

export { KpiCards, NEEDS_ATTENTION_STATES }
