"use client"

import { Activity, ArrowRight, Clock3, Star, TrendingUp } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { useNabaPresenceDashboard } from "@/components/naba-presence/review-app"
import {
  chartConfig,
  EmptyData,
  formatDuration,
  LiveDataError,
  MetricCard,
  PageFrame,
  PageHeader,
} from "@/components/naba-presence/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { type AnalyticsOverview, loadAnalytics } from "@/lib/naba-presence-api"

export function HomeView() {
  const { reviews, apiStatus, connectionState } = useNabaPresenceDashboard()
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    const to = new Date()
    const from = new Date(to.getTime() - 30 * 86_400_000)
    void loadAnalytics({
      from: from.toISOString(),
      to: to.toISOString(),
      granularity: "day",
    })
      .then((result) => {
        if (!active) return
        setAnalytics(result)
        setStatus("ready")
      })
      .catch(() => {
        if (active) setStatus("error")
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  const summary = analytics?.summary
  const needsAttention = reviews.filter(
    (review) => review.status === "needs_reply" || review.status === "escalated"
  ).length
  const chartData =
    analytics?.series.map((point) => ({
      label: new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: analytics.timezone,
      }).format(new Date(point.period)),
      reviews: point.reviews,
      replies: point.replies,
    })) ?? []
  const attention = [...(analytics?.locations ?? [])]
    .sort((a, b) => b.unresolvedComplaints - a.unresolvedComplaints)
    .filter((location) => location.unresolvedComplaints > 0)
    .slice(0, 5)

  function retry() {
    setAnalytics(null)
    setStatus("loading")
    setReloadKey((value) => value + 1)
  }

  return (
    <PageFrame width="wide">
      <PageHeader
        title="Home"
        description="Google presence across every connected location, for the last 30 days."
        actions={
          <Link href="/inbox" className={buttonVariants()}>
            Open inbox
            <ArrowRight data-icon="inline-end" />
          </Link>
        }
      />

      {connectionState === "disconnected" ? (
        <Alert variant="destructive">
          <Activity />
          <AlertTitle>Google is not connected</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>
              No active Google connection exists, so no location data can be
              synchronised.
            </span>
            <Link
              href="/settings/connections"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Manage connection
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      {status === "error" ? <LiveDataError onRetry={retry} /> : null}

      <div className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Average rating"
          value={
            !summary || summary.averageRating === null
              ? "—"
              : summary.averageRating.toFixed(1)
          }
          detail="Google reviews · last 30 days"
          icon={Star}
        />
        <MetricCard
          title="Response rate"
          value={
            !summary || summary.responseRate === null
              ? "—"
              : `${summary.responseRate}%`
          }
          detail="Published or accepted replies"
          icon={TrendingUp}
        />
        <MetricCard
          title="Median first response"
          value={
            summary ? formatDuration(summary.medianFirstResponseSeconds) : "—"
          }
          detail="From review to first reply"
          icon={Clock3}
        />
        <MetricCard
          title="Needs attention"
          value={
            apiStatus === "loading" || apiStatus === "error"
              ? "—"
              : `${needsAttention}`
          }
          detail="Loaded inbox page"
          icon={Activity}
        />
      </div>

      <div className="grid gap-(--nr-gap-card) xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.7fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Reviews and replies</CardTitle>
            <CardDescription>
              Thirty-day volume across all locations
            </CardDescription>
          </CardHeader>
          <CardContent>
            {status === "loading" ? (
              <Skeleton className="h-[260px] w-full" />
            ) : chartData.length ? (
              <ChartContainer
                config={chartConfig}
                className="h-[260px] w-full"
                initialDimension={{ width: 760, height: 260 }}
              >
                <AreaChart
                  accessibilityLayer
                  data={chartData}
                  margin={{ left: -18, right: 10, top: 10 }}
                >
                  <defs>
                    <linearGradient
                      id="home-reviews-fill"
                      x1="0"
                      x2="0"
                      y1="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="var(--color-reviews)"
                        stopOpacity={0.2}
                      />
                      <stop
                        offset="95%"
                        stopColor="var(--color-reviews)"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={10}
                  />
                  <YAxis tickLine={false} axisLine={false} width={36} />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent indicator="line" />}
                  />
                  <Area
                    dataKey="reviews"
                    type="monotone"
                    fill="url(#home-reviews-fill)"
                    stroke="var(--color-reviews)"
                    strokeWidth={2}
                  />
                  <Area
                    dataKey="replies"
                    type="monotone"
                    fill="transparent"
                    stroke="var(--color-replies)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <EmptyData message="No review activity was recorded in the last 30 days." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>
              Locations with unresolved one- and two-star reviews
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {status === "loading" ? (
              <>
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </>
            ) : attention.length ? (
              attention.map((location) => (
                <div
                  key={location.name}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="min-w-0 truncate text-sm font-medium">
                    {location.name}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {location.unresolvedComplaints}
                  </span>
                </div>
              ))
            ) : (
              <EmptyData message="No location has unresolved low-rated reviews." />
            )}
          </CardContent>
        </Card>
      </div>
    </PageFrame>
  )
}
