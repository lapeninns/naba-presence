"use client"

import Link from "next/link"
import { useState } from "react"

import { HomeSection } from "@/components/home/home-section"
import { DivergenceBanner } from "@/components/home/divergence-banner"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { buttonVariants } from "@/components/ui/button"
import {
  ChartCard,
  ReportingAreaChart,
  type ColorVar,
} from "@/components/ui/chart"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import type { AnalyticsOverview } from "@/lib/api/analytics"
import { formatDate } from "@/lib/format"

const HEADING_ID = "pulse-heading"

/**
 * Three views of the same 30-day series. The window is fixed here (Home reads
 * the organisation's 30-day overview, the same query the health tiles use);
 * ranges, deltas and per-client cuts live on Reports.
 */
const METRICS = [
  {
    id: "reviews",
    segment: "Reviews",
    title: "Review volume",
    key: "reviewCount",
    colorVar: 1,
  },
  {
    id: "replies",
    segment: "Replies",
    title: "Reply volume",
    key: "replies",
    colorVar: 4,
  },
  {
    id: "rating",
    segment: "Rating",
    title: "Average rating",
    key: "averageRating",
    colorVar: 3,
  },
] as const satisfies ReadonlyArray<{
  id: string
  segment: string
  title: string
  key: keyof AnalyticsOverview["series"][number]
  colorVar: ColorVar
}>

type MetricId = (typeof METRICS)[number]["id"]

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
  const [metricId, setMetricId] = useState<MetricId>("reviews")
  const metric = METRICS.find((m) => m.id === metricId) ?? METRICS[0]

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
    <HomeSection
      id={HEADING_ID}
      title="Pulse"
      description="The last 30 days, day by day. Open Reports for ranges, deltas and Google visibility."
    >
      {overview ? (
        <DivergenceBanner providerTotals={overview.providerTotals} />
      ) : null}
      <ChartCard
        title={metric.title}
        description={
          <FetchedAtCaption
            iso={overview?.to ?? null}
            timezone={timezone}
            pending={isPending}
          />
        }
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SegmentedControl
              aria-label="Pulse metric"
              size="sm"
              value={metricId}
              onValueChange={(next) => setMetricId(next as MetricId)}
            >
              {METRICS.map((m) => (
                <SegmentedControlItem key={m.id} value={m.id}>
                  {m.segment}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
            <Link
              href="/reports"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              See reports
            </Link>
          </div>
        }
        state={state}
        onRetry={onRetry}
        emptyLabel="No reviews in the last 30 days."
      >
        <ReportingAreaChart
          data={overview?.series ?? []}
          xKey="period"
          xTickFormatter={tick}
          series={[
            {
              key: metric.key,
              label: metric.segment,
              colorVar: metric.colorVar,
            },
          ]}
        />
      </ChartCard>
    </HomeSection>
  )
}

export { PulseChart }
