"use client"

import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Star,
  TrendingUp,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import {
  type AnalyticsOverview,
  type GoogleConnection,
  loadAnalytics,
  loadConnections,
  loadSettings,
  type OrganisationSettings,
} from "@/lib/naba-presence-api"
import { Review } from "@/lib/naba-presence-data"
import {
  BusinessContext,
  chartConfig,
  EmptyData,
  formatDuration,
  formatTimestamp,
  LiveDataError,
  MetricCard,
  PageFrame,
  PageHeader,
} from "@/components/naba-presence/shared"

type Navigate = (view: "reviews" | "analytics" | "connections") => void

export function OverviewView({
  reviews,
  onNavigate,
  displayName,
  organisationName,
}: {
  reviews: Review[]
  onNavigate: Navigate
  displayName: string
  organisationName: string
}) {
  const [overviewData, setOverviewData] = useState<{
    analytics: AnalyticsOverview
    connections: GoogleConnection[]
    settings: OrganisationSettings
  } | null>(null)
  const [overviewStatus, setOverviewStatus] = useState<
    "loading" | "ready" | "error"
  >("loading")
  const [reloadKey, setReloadKey] = useState(0)
  const [greeting, setGreeting] = useState<"morning" | "afternoon" | "evening">(
    "morning"
  )

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const hour = new Date().getHours()
      setGreeting(hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening")
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [])

  useEffect(() => {
    let active = true
    const to = new Date()
    const from = new Date(to.getTime() - 7 * 86400000)
    void Promise.all([
      loadAnalytics({
        from: from.toISOString(),
        to: to.toISOString(),
        granularity: "day",
      }),
      loadConnections(),
      loadSettings(),
    ])
      .then(([analytics, connectionResult, settingsResult]) => {
        if (!active) return
        setOverviewData({
          analytics,
          connections: connectionResult.connections,
          settings: settingsResult.settings,
        })
        setOverviewStatus("ready")
      })
      .catch(() => {
        if (!active) return
        setOverviewData(null)
        setOverviewStatus("error")
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  const needsAttention = reviews.filter(
    (review) => review.status === "needs_reply" || review.status === "escalated"
  ).length
  const summary = overviewData?.analytics.summary
  const connection =
    overviewData?.connections.find((item) => item.status === "active") ??
    overviewData?.connections[0]
  const connectionHealthy =
    connection?.status === "active" && !connection.reconnectRequired
  const chartData =
    overviewData?.analytics.series.map((point) => ({
      label: new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
      }).format(new Date(point.period)),
      reviews: point.reviews,
      replies: point.replies,
    })) ?? []

  function retryOverview() {
    setOverviewData(null)
    setOverviewStatus("loading")
    setReloadKey((value) => value + 1)
  }

  return (
    <PageFrame width="wide">
      <PageHeader
        title={`Good ${greeting}, ${displayName.split(/\s+/)[0] || "there"}`}
        description="Review and reply operations across your connected Google Business Profiles."
        actions={
          <Button onClick={() => onNavigate("reviews")}>
            Open review inbox
            <ArrowRight data-icon="inline-end" />
          </Button>
        }
      />

      <BusinessContext
        organisationName={organisationName}
        detail="Google review operations"
        status={{
          label: "Needs attention",
          value: `${needsAttention} reviews today`,
        }}
      />

      <div className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Average rating"
          value={
            summary?.averageRating === null || !summary
              ? "—"
              : summary.averageRating.toFixed(1)
          }
          detail="Google reviews · last 7 days"
          icon={Star}
        />
        <MetricCard
          title="Response rate"
          value={
            summary?.responseRate === null || !summary
              ? "—"
              : `${summary.responseRate}%`
          }
          detail="Published or accepted replies"
          icon={TrendingUp}
        />
        <MetricCard
          title="Median response"
          value={summary ? formatDuration(summary.medianResponseSeconds) : "—"}
          detail="From review to reply"
          icon={Clock3}
        />
        <MetricCard
          title="Needs attention"
          value={`${needsAttention}`}
          detail="Current inbox page"
          icon={Activity}
        />
      </div>

      <div className="grid gap-(--nr-gap-card) xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.7fr)]">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <CardTitle>Reviews and replies</CardTitle>
              <CardDescription>
                Seven-day operational volume across all locations
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigate("analytics")}
            >
              View analytics
              <ArrowRight data-icon="inline-end" />
            </Button>
          </CardHeader>
          <CardContent>
            {overviewStatus === "loading" ? (
              <Skeleton className="h-[260px] w-full" />
            ) : overviewStatus === "error" ? (
              <LiveDataError onRetry={retryOverview} />
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
                      id="reviews-fill"
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
                    fill="url(#reviews-fill)"
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
              <EmptyData message="No review activity was recorded in the last 7 days." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Operations health</CardTitle>
            <CardDescription>
              Google connection and review-sync status
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {overviewStatus === "loading" ? (
              <>
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </>
            ) : overviewStatus === "error" ? (
              <LiveDataError onRetry={retryOverview} />
            ) : (
              <>
                <HealthRow
                  label="Google connection"
                  detail={
                    connection
                      ? connectionHealthy
                        ? `Active${connection.lastRefreshAt ? ` · refreshed ${formatTimestamp(connection.lastRefreshAt)}` : ""}`
                        : connection.reconnectRequired
                          ? "Reconnect required"
                          : connection.status
                      : "Not connected"
                  }
                  healthy={Boolean(connectionHealthy)}
                />
                <HealthRow
                  label="Google notifications"
                  detail={
                    connection?.notificationsEnabled
                      ? "Configured"
                      : "Not configured · scheduled sync remains available"
                  }
                  healthy={Boolean(connection?.notificationsEnabled)}
                />
                <HealthRow
                  label="Raw-content retention"
                  detail={`${overviewData?.settings.rawContentRetentionDays ?? "—"} days`}
                  healthy={Boolean(overviewData?.settings)}
                />
              </>
            )}
          </CardContent>
          <CardFooter>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => onNavigate("connections")}
            >
              Manage connection
            </Button>
          </CardFooter>
        </Card>
      </div>
    </PageFrame>
  )
}

function HealthRow({
  label,
  detail,
  healthy,
}: {
  label: string
  detail: string
  healthy: boolean
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        {healthy ? (
          <CheckCircle2 className="size-4" aria-hidden />
        ) : (
          <Activity className="size-4" aria-hidden />
        )}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}
