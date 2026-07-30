"use client"

import {
  Activity,
  CheckCircle2,
  Clock3,
  ShieldCheck,
  Star,
  TrendingUp,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { type AnalyticsOverview, loadAnalytics } from "@/lib/naba-presence-api"
import {
  chartConfig,
  EmptyData,
  formatDuration,
  LiveDataError,
  MetricCard,
  PageFrame,
  PageHeader,
} from "@/components/naba-presence/shared"

export function AnalyticsView() {
  const [liveAnalytics, setLiveAnalytics] = useState<AnalyticsOverview | null>(
    null
  )
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d" | "365d">(
    "30d"
  )
  const [granularity, setGranularity] = useState<"day" | "week" | "month">(
    "day"
  )
  const [analyticsStatus, setAnalyticsStatus] = useState<
    "loading" | "ready" | "error"
  >("loading")
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    const days = Number.parseInt(dateRange)
    const to = new Date()
    const from = new Date(to.getTime() - days * 86400000)
    void loadAnalytics({
      from: from.toISOString(),
      to: to.toISOString(),
      granularity,
    })
      .then((analytics) => {
        if (!active) return
        setLiveAnalytics(analytics)
        setAnalyticsStatus("ready")
      })
      .catch(() => {
        if (active) setAnalyticsStatus("error")
      })
    return () => {
      active = false
    }
  }, [dateRange, granularity, reloadKey])

  const summary = liveAnalytics?.summary
  const rangeLabel =
    dateRange === "365d" ? "12 months" : `${Number.parseInt(dateRange)} days`
  const chartData =
    liveAnalytics?.series.map((point) => ({
      label: new Intl.DateTimeFormat("en-GB", {
        day: granularity === "month" ? undefined : "numeric",
        month: "short",
        year: granularity === "month" ? "2-digit" : undefined,
        timeZone: liveAnalytics.timezone,
      }).format(new Date(point.period)),
      reviews: point.reviews,
      replies: point.replies,
    })) ?? []
  const rows =
    liveAnalytics?.locations.map((location) => ({
      location: location.name,
      rating:
        location.averageRating === null
          ? "—"
          : location.averageRating.toFixed(1),
      reviews: location.reviews,
      responseRate:
        location.responseRate === null ? "—" : `${location.responseRate}%`,
      responseRateValue: location.responseRate ?? 0,
      firstResponse: formatDuration(location.medianFirstResponseSeconds),
      p95FirstResponse: formatDuration(location.p95FirstResponseSeconds),
      latestEdit: formatDuration(location.medianLatestEditSeconds),
      complaints: location.unresolvedComplaints,
      rejectionRate:
        location.verificationRejectionRate === null
          ? "—"
          : `${location.verificationRejectionRate}%`,
    })) ?? []

  function beginAnalyticsLoad() {
    setLiveAnalytics(null)
    setAnalyticsStatus("loading")
  }

  function retryAnalytics() {
    beginAnalyticsLoad()
    setReloadKey((value) => value + 1)
  }

  return (
    <PageFrame width="wide">
      <PageHeader
        title="Analytics"
        description={`Google review and reply performance for the last ${rangeLabel}.`}
        actions={
          <>
            <NativeSelect
              size="sm"
              value={dateRange}
              onValueChange={(value) => {
                beginAnalyticsLoad()
                setDateRange(value as "7d" | "30d" | "90d" | "365d")
              }}
              aria-label="Analytics date range"
            >
              <NativeSelectOption value="7d">Last 7 days</NativeSelectOption>
              <NativeSelectOption value="30d">Last 30 days</NativeSelectOption>
              <NativeSelectOption value="90d">Last 90 days</NativeSelectOption>
              <NativeSelectOption value="365d">
                Last 12 months
              </NativeSelectOption>
            </NativeSelect>
            <NativeSelect
              size="sm"
              value={granularity}
              onValueChange={(value) => {
                beginAnalyticsLoad()
                setGranularity(value as "day" | "week" | "month")
              }}
              aria-label="Analytics granularity"
            >
              <NativeSelectOption value="day">Daily</NativeSelectOption>
              <NativeSelectOption value="week">Weekly</NativeSelectOption>
              <NativeSelectOption value="month">Monthly</NativeSelectOption>
            </NativeSelect>
          </>
        }
      />

      {analyticsStatus === "error" ? (
        <LiveDataError onRetry={retryAnalytics} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Google reviews"
          value={summary ? String(summary.reviewVolume) : "—"}
          detail={`Current ${rangeLabel} window`}
          icon={Star}
        />
        <MetricCard
          title="Average rating"
          value={
            summary?.averageRating === null || !summary
              ? "—"
              : summary.averageRating.toFixed(1)
          }
          detail="Google reviews only"
          icon={TrendingUp}
        />
        <MetricCard
          title="Response rate"
          value={
            summary?.responseRate === null || !summary
              ? "—"
              : `${summary.responseRate}%`
          }
          detail="Published or accepted replies"
          icon={CheckCircle2}
        />
        <MetricCard
          title="Median first response"
          value={
            summary
              ? formatDuration(summary.medianFirstResponseSeconds)
              : "—"
          }
          detail="From review to first reply"
          icon={Clock3}
        />
        <MetricCard
          title="P95 first response"
          value={
            summary
              ? formatDuration(summary.p95FirstResponseSeconds)
              : "—"
          }
          detail="95% of first responses are faster"
          icon={Clock3}
        />
        <MetricCard
          title="Median latest edit"
          value={
            summary
              ? formatDuration(summary.medianLatestEditSeconds)
              : "—"
          }
          detail="From review to latest reply edit"
          icon={Clock3}
        />
        <MetricCard
          title="Unresolved complaints"
          value={summary ? String(summary.unresolvedComplaints) : "—"}
          detail="1–2 star reviews without a live reply"
          icon={Activity}
        />
        <MetricCard
          title="Verification rejection"
          value={
            summary?.verificationRejectionRate === null || !summary
              ? "—"
              : `${summary.verificationRejectionRate}%`
          }
          detail={
            summary
              ? `${summary.verificationFailures} latest drafts failed`
              : "Latest draft verification results"
          }
          icon={ShieldCheck}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Review and reply volume</CardTitle>
          <CardDescription>
            {granularity[0]?.toUpperCase() + granularity.slice(1)} Google review
            volume for the selected window
          </CardDescription>
        </CardHeader>
        <CardContent>
          {analyticsStatus === "loading" ? (
            <Skeleton className="h-[280px] w-full" />
          ) : chartData.length ? (
            <ChartContainer
              config={chartConfig}
              className="h-[280px] w-full"
              initialDimension={{ width: 960, height: 280 }}
            >
              <AreaChart
                accessibilityLayer
                data={chartData}
                margin={{ left: -18, right: 10, top: 10 }}
              >
                <defs>
                  <linearGradient
                    id="analytics-reviews-fill"
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
                  fill="url(#analytics-reviews-fill)"
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
            <EmptyData message="No review activity exists for this date range." />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Location performance</CardTitle>
          <CardDescription>
            Response speed and coverage across linked Google locations
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table className="min-w-[1080px]" tabIndex={0}>
            <TableHeader>
              <TableRow>
                <TableHead>Location</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Reviews</TableHead>
                <TableHead>Response rate</TableHead>
                <TableHead className="text-right">
                  Median first response
                </TableHead>
                <TableHead className="text-right">
                  P95 first response
                </TableHead>
                <TableHead className="text-right">
                  Median latest edit
                </TableHead>
                <TableHead className="text-right">Unresolved</TableHead>
                <TableHead className="text-right">
                  Verification rejection
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.location}>
                  <TableCell className="font-medium">{row.location}</TableCell>
                  <TableCell className="font-mono text-xs">
                    <span className="inline-flex items-center gap-1">
                      <Star
                        className="size-4 fill-rating text-rating"
                        aria-hidden
                      />
                      {row.rating}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.reviews}
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-32 flex-col gap-1.5">
                      <span className="font-mono text-xs">
                        {row.responseRate}
                      </span>
                      <Progress
                        value={row.responseRateValue}
                        aria-label={`Response rate for ${row.location}`}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {row.firstResponse}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {row.p95FirstResponse}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {row.latestEdit}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {row.complaints}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {row.rejectionRate}
                  </TableCell>
                </TableRow>
              ))}
              {analyticsStatus === "ready" && rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-10 text-center text-muted-foreground"
                  >
                    No linked location data exists for this date range.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Alert>
        <ShieldCheck />
        <AlertTitle>Policy-aware analytics</AlertTitle>
        <AlertDescription>
          These aggregates are separated from transient Google content. Raw
          review text remains subject to the organisation’s configured retention
          policy.
        </AlertDescription>
      </Alert>
    </PageFrame>
  )
}
