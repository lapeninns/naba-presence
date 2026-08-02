"use client"

import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { ChartCard, ChartLegend, ReportingBarChart, ReportingLineChart } from "@/components/ui/chart"
import { DivergenceBanner } from "@/components/home/divergence-banner"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { formatDate } from "@/lib/format"
import { useAnalyticsOverview } from "@/lib/queries/use-analytics-overview"

function HomeCharts() {
  const analytics = useAnalyticsOverview()
  const state = analytics.isPending
    ? "loading"
    : analytics.isError
      ? "error"
      : (analytics.data.series.some((p) => p.reviewCount > 0) ? "ready" : "empty")
  const timezone = analytics.data?.timezone ?? "UTC"
  const tick = (iso: string) => formatDate(iso, timezone)
  const seeMore = (
    <Link href="/performance" className={buttonVariants({ variant: "outline", size: "sm" })}>
      See Performance
    </Link>
  )

  return (
    <section aria-labelledby="home-trends-heading" className="flex flex-col gap-3">
      <h2 id="home-trends-heading" className="text-title font-semibold tracking-tight">
        Trends
      </h2>
      {analytics.data ? <DivergenceBanner providerTotals={analytics.data.providerTotals} /> : null}
      <div className="grid gap-(--nr-gap-card) lg:grid-cols-2">
        <ChartCard
          title="Review volume"
          description={<FetchedAtCaption iso={analytics.data?.to ?? null} timezone={timezone} />}
          action={seeMore}
          state={state}
          onRetry={() => void analytics.refetch()}
          emptyLabel="No reviews in the last 30 days."
        >
          <ReportingBarChart
            data={analytics.data?.series ?? []}
            xKey="period"
            xTickFormatter={tick}
            series={[{ key: "reviewCount", label: "Reviews", colorVar: 1 }]}
          />
        </ChartCard>
        <ChartCard
          title="Average rating"
          description={<ChartLegend items={[{ label: "Daily average", colorVar: 3 }]} />}
          action={seeMore}
          state={state}
          onRetry={() => void analytics.refetch()}
          emptyLabel="No rated reviews in the last 30 days."
        >
          <ReportingLineChart
            data={analytics.data?.series ?? []}
            xKey="period"
            xTickFormatter={tick}
            series={[{ key: "averageRating", label: "Daily average", colorVar: 3 }]}
          />
        </ChartCard>
      </div>
    </section>
  )
}

export { HomeCharts }
