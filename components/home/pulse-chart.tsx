"use client"

import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { ChartCard, ReportingBarChart } from "@/components/ui/chart"
import { DivergenceBanner } from "@/components/home/divergence-banner"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import type { AnalyticsOverview } from "@/lib/api/analytics"
import { formatDate } from "@/lib/format"

const HEADING_ID = "pulse-heading"

function PulseChart({
  overview,
  isPending,
  isError,
  onRetry,
}: {
  overview: AnalyticsOverview | undefined
  isPending?: boolean
  isError?: boolean
  onRetry: () => void
}) {
  const state = isPending
    ? "loading"
    : isError
      ? "error"
      : overview?.series.some((point) => point.reviewCount > 0)
        ? "ready"
        : "empty"
  const timezone = overview?.timezone ?? "UTC"
  const tick = (iso: string) => formatDate(iso, timezone)

  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id={HEADING_ID} className="text-title font-semibold tracking-tight">
          Pulse
        </h2>
        <p className="text-caption text-muted-foreground">
          Review volume over the last 30 days. Open Performance for ranges,
          deltas, and Google visibility.
        </p>
      </div>
      {overview ? (
        <DivergenceBanner providerTotals={overview.providerTotals} />
      ) : null}
      <ChartCard
        title="Review volume"
        description={
          <FetchedAtCaption iso={overview?.to ?? null} timezone={timezone} />
        }
        action={
          <Link
            href="/reports"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            See reports
          </Link>
        }
        state={state}
        onRetry={onRetry}
        emptyLabel="No reviews in the last 30 days."
      >
        <ReportingBarChart
          data={overview?.series ?? []}
          xKey="period"
          xTickFormatter={tick}
          series={[{ key: "reviewCount", label: "Reviews", colorVar: 1 }]}
        />
      </ChartCard>
    </section>
  )
}

export { PulseChart }
