"use client"

import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Link2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  Unplug,
} from "lucide-react"
import { useEffect, useState, useTransition } from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import {
  beginGoogleConnect,
  activateGoogleAccounts,
  addMember,
  type BackfillProgress,
  cancelBackfill,
  configureGoogleNotifications,
  createPrivacyRequest,
  disconnectGoogle,
  discoverGoogleAccounts,
  discoverGoogleLocations,
  type AnalyticsOverview,
  type GoogleAccount,
  type GoogleConnection,
  type GoogleLocation,
  linkGoogleLocation,
  loadAnalytics,
  loadBackfillProgress,
  loadConnections,
  loadInternalLocations,
  loadMembers,
  loadSettings,
  type InternalLocation,
  type OrganisationMember,
  runBackfill,
  saveLocationAssignments,
  saveSettings,
  updateMember,
} from "@/lib/naba-review-api"
import {
  LOCATION_METRICS,
  PERFORMANCE_DATA,
  Review,
} from "@/lib/naba-review-data"

const chartConfig = {
  reviews: {
    label: "Reviews",
    color: "var(--chart-1)",
  },
  replies: {
    label: "Replies",
    color: "var(--chart-4)",
  },
} satisfies ChartConfig

type Navigate = (view: "reviews" | "analytics" | "connections") => void

function readControlValue(event: { currentTarget: unknown }) {
  return (event.currentTarget as { value: string }).value
}

export function OverviewView({
  reviews,
  onNavigate,
}: {
  reviews: Review[]
  onNavigate: Navigate
}) {
  const needsAttention = reviews.filter(
    (review) => review.status === "needs_reply" || review.status === "escalated"
  ).length
  const published = reviews.filter(
    (review) => review.status === "published"
  ).length
  const responseRate = Math.round((published / reviews.length) * 100)

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 py-7 md:px-8 md:py-9">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">
            Good morning, Maya
          </h1>
          <p className="text-sm text-muted-foreground">
            Lapen Inns has {needsAttention} reviews that need attention today.
          </p>
        </div>
        <Button onClick={() => onNavigate("reviews")}>
          Open review inbox
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Average rating"
          value="4.5"
          detail="+0.2 this month"
          icon={Star}
        />
        <MetricCard
          title="Response rate"
          value={`${responseRate}%`}
          detail="Target 95%"
          icon={TrendingUp}
        />
        <MetricCard
          title="Median response"
          value="3h 14m"
          detail="48m faster"
          icon={Clock3}
        />
        <MetricCard
          title="Needs attention"
          value={`${needsAttention}`}
          detail="1 escalation"
          icon={Activity}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.7fr)]">
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
            <ChartContainer
              config={chartConfig}
              className="h-[260px] w-full"
              initialDimension={{ width: 760, height: 260 }}
            >
              <AreaChart
                accessibilityLayer
                data={PERFORMANCE_DATA}
                margin={{ left: -18, right: 10, top: 10 }}
              >
                <defs>
                  <linearGradient id="reviews-fill" x1="0" x2="0" y1="0" y2="1">
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
                  dataKey="day"
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
            <HealthRow
              label="Google connection"
              detail="Active · refreshed 4m ago"
              healthy
            />
            <HealthRow
              label="Pub/Sub notifications"
              detail="Healthy · no backlog"
              healthy
            />
            <HealthRow
              label="Reconciliation"
              detail="Last run 11m ago"
              healthy
            />
            <Separator />
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-sm">
                <span>30-day content window</span>
                <span className="font-medium">7 days left</span>
              </div>
              <Progress value={77} />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Raw Google review text is automatically purged on schedule.
              </p>
            </div>
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
    </div>
  )
}

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
}: {
  title: string
  value: string
  detail: string
  icon: typeof Star
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardDescription>{title}</CardDescription>
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <p className="text-2xl font-medium tracking-tight">{value}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
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
        if (active) setLiveAnalytics(analytics)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [dateRange, granularity])

  const summary = liveAnalytics?.summary
  const rangeLabel =
    dateRange === "365d" ? "12 months" : `${Number.parseInt(dateRange)} days`
  const chartData = liveAnalytics
    ? liveAnalytics.series.map((point) => ({
        label: new Intl.DateTimeFormat("en-GB", {
          day: granularity === "month" ? undefined : "numeric",
          month: "short",
          year: granularity === "month" ? "2-digit" : undefined,
        }).format(new Date(point.period)),
        reviews: point.reviews,
        replies: point.replies,
      }))
    : PERFORMANCE_DATA.map((point) => ({
        label: point.day,
        reviews: point.reviews,
        replies: point.replies,
      }))
  const rows = liveAnalytics
    ? liveAnalytics.locations.map((location) => ({
        location: location.name,
        rating: (location.averageRating ?? 0).toFixed(1),
        reviews: location.reviews,
        responseRate: `${location.responseRate ?? 0}%`,
        median: formatDuration(location.medianResponseSeconds),
        p95: formatDuration(location.p95ResponseSeconds),
        complaints: location.unresolvedComplaints,
        rejectionRate: `${location.verificationRejectionRate ?? 0}%`,
      }))
    : LOCATION_METRICS.map((location) => ({
        ...location,
        p95: "6h 40m",
        complaints: 2,
        rejectionRate: "1.8%",
      }))

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-7 px-5 py-7 md:px-8 md:py-9">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">
            Analytics
          </h1>
          <p className="text-sm text-muted-foreground">
            Google review and reply performance for the last {rangeLabel}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <NativeSelect
            size="sm"
            value={dateRange}
            onValueChange={(value) =>
              setDateRange(value as "7d" | "30d" | "90d" | "365d")
            }
            aria-label="Analytics date range"
          >
            <NativeSelectOption value="7d">Last 7 days</NativeSelectOption>
            <NativeSelectOption value="30d">Last 30 days</NativeSelectOption>
            <NativeSelectOption value="90d">Last 90 days</NativeSelectOption>
            <NativeSelectOption value="365d">Last 12 months</NativeSelectOption>
          </NativeSelect>
          <NativeSelect
            size="sm"
            value={granularity}
            onValueChange={(value) =>
              setGranularity(value as "day" | "week" | "month")
            }
            aria-label="Analytics granularity"
          >
            <NativeSelectOption value="day">Daily</NativeSelectOption>
            <NativeSelectOption value="week">Weekly</NativeSelectOption>
            <NativeSelectOption value="month">Monthly</NativeSelectOption>
          </NativeSelect>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Google reviews"
          value={String(summary?.reviewVolume ?? 459)}
          detail={`Current ${rangeLabel} window`}
          icon={Star}
        />
        <MetricCard
          title="Average rating"
          value={(summary?.averageRating ?? 4.5).toFixed(1)}
          detail={summary ? "Google reviews only" : "+0.2 vs prior period"}
          icon={TrendingUp}
        />
        <MetricCard
          title="Response rate"
          value={`${summary?.responseRate ?? 92}%`}
          detail={summary ? "Published or accepted replies" : "+6 points"}
          icon={CheckCircle2}
        />
        <MetricCard
          title="Median response"
          value={
            summary ? formatDuration(summary.medianResponseSeconds) : "3h 14m"
          }
          detail={summary ? "From review to reply" : "18% faster"}
          icon={Clock3}
        />
        <MetricCard
          title="P95 response"
          value={
            summary ? formatDuration(summary.p95ResponseSeconds) : "7h 42m"
          }
          detail="95% of responses are faster"
          icon={Clock3}
        />
        <MetricCard
          title="Unresolved complaints"
          value={String(summary?.unresolvedComplaints ?? 8)}
          detail="1–2 star reviews without a live reply"
          icon={Activity}
        />
        <MetricCard
          title="Verification rejection"
          value={`${summary?.verificationRejectionRate ?? 2.1}%`}
          detail={`${summary?.verificationFailures ?? 4} latest drafts failed`}
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
          <table className="w-full min-w-[1080px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-2 py-3 font-medium">Location</th>
                <th className="px-2 py-3 font-medium">Rating</th>
                <th className="px-2 py-3 font-medium">Reviews</th>
                <th className="px-2 py-3 font-medium">Response rate</th>
                <th className="px-2 py-3 text-right font-medium">
                  Median response
                </th>
                <th className="px-2 py-3 text-right font-medium">
                  P95 response
                </th>
                <th className="px-2 py-3 text-right font-medium">Unresolved</th>
                <th className="px-2 py-3 text-right font-medium">
                  Verification rejection
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.location} className="border-b last:border-0">
                  <td className="px-2 py-4 font-medium">{row.location}</td>
                  <td className="px-2 py-4">
                    <span className="inline-flex items-center gap-1">
                      <Star
                        className="size-4 fill-rating text-rating"
                        aria-hidden
                      />
                      {row.rating}
                    </span>
                  </td>
                  <td className="px-2 py-4">{row.reviews}</td>
                  <td className="px-2 py-4">
                    <div className="flex items-center gap-3">
                      <Progress
                        value={Number.parseInt(row.responseRate)}
                        className="w-28"
                      />
                      <span>{row.responseRate}</span>
                    </div>
                  </td>
                  <td className="px-2 py-4 text-right">{row.median}</td>
                  <td className="px-2 py-4 text-right">{row.p95}</td>
                  <td className="px-2 py-4 text-right">{row.complaints}</td>
                  <td className="px-2 py-4 text-right">{row.rejectionRate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Review themes</CardTitle>
            <CardDescription>
              Frequent topics in retained review content
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ThemeBar label="Service" value={78} detail="142 mentions" />
            <ThemeBar label="Location" value={63} detail="116 mentions" />
            <ThemeBar label="Breakfast" value={48} detail="88 mentions" />
            <ThemeBar label="Room comfort" value={31} detail="57 mentions" />
          </CardContent>
        </Card>
        <Alert>
          <ShieldCheck />
          <AlertTitle>Policy-aware analytics</AlertTitle>
          <AlertDescription>
            These aggregates are separated from transient Google content. Raw
            review text remains subject to the configured 30-day retention
            window.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  )
}

function formatDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return "—"
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

function ThemeBar({
  label,
  value,
  detail,
}: {
  label: string
  value: number
  detail: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{detail}</span>
      </div>
      <Progress value={value} />
    </div>
  )
}

function formatAddress(
  address: GoogleLocation["storefrontAddress"] | null | undefined
) {
  if (!address) return ""
  return [
    ...(address.addressLines ?? []),
    address.locality,
    address.administrativeArea,
    address.postalCode,
  ]
    .filter(Boolean)
    .join(", ")
}

function formatGoogleAddress(location: GoogleLocation) {
  return formatAddress(location.storefrontAddress)
}

function isLocationCandidate(
  googleLocation: GoogleLocation,
  internalLocation: InternalLocation
) {
  const titleMatch =
    internalLocation.name.trim().toLowerCase() ===
    (googleLocation.title ?? googleLocation.name).trim().toLowerCase()
  const googleAddress = formatAddress(googleLocation.storefrontAddress)
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
  const internalAddress = formatAddress(internalLocation.address)
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
  return (
    titleMatch ||
    (Boolean(googleAddress) &&
      Boolean(internalAddress) &&
      googleAddress === internalAddress)
  )
}

export function ConnectionsView() {
  const [connections, setConnections] = useState<GoogleConnection[] | null>(
    null
  )
  const [locations, setLocations] = useState<GoogleLocation[]>([])
  const [accounts, setAccounts] = useState<GoogleAccount[]>([])
  const [backfillProgress, setBackfillProgress] =
    useState<BackfillProgress | null>(null)
  const [internalLocations, setInternalLocations] = useState<
    InternalLocation[]
  >([])
  const [linkTargets, setLinkTargets] = useState<Record<string, string>>({})
  const [locationQuery, setLocationQuery] = useState("")
  const [verificationFilter, setVerificationFilter] = useState("all")
  const [pubsubTopic, setPubsubTopic] = useState("")
  const [message, setMessage] = useState("")
  const [isPending, startTransition] = useTransition()
  const connection = connections?.[0]
  const isPreview = connections === null

  useEffect(() => {
    let active = true
    void Promise.all([
      loadConnections(),
      loadInternalLocations(),
      loadBackfillProgress(),
    ])
      .then(([connectionResult, locationResult, backfillResult]) => {
        if (active) {
          setConnections(connectionResult.connections)
          setInternalLocations(locationResult.locations)
          setBackfillProgress(backfillResult.progress)
        }
      })
      .catch(() => {
        if (active) setMessage("Preview mode · database connection unavailable")
      })
    return () => {
      active = false
    }
  }, [])

  function connect() {
    setMessage("")
    startTransition(async () => {
      try {
        const { authorizationUrl } = await beginGoogleConnect()
        window.location.assign(authorizationUrl)
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Connect failed.")
      }
    })
  }

  function discover() {
    setMessage("")
    startTransition(async () => {
      try {
        if (!accounts.length) {
          const result = await discoverGoogleAccounts()
          setAccounts(result.accounts)
          setMessage(
            `${result.accounts.length} Google account${result.accounts.length === 1 ? "" : "s"} discovered. Select the accounts to activate.`
          )
          return
        }
        const result = await discoverGoogleLocations()
        setLocations(result.locations)
        setMessage(
          `${result.locations.length} Google location${result.locations.length === 1 ? "" : "s"} discovered.`
        )
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Discovery failed.")
      }
    })
  }

  function toggleAccount(account: GoogleAccount) {
    setMessage("")
    startTransition(async () => {
      try {
        const activeIds = accounts
          .filter((item) =>
            item.id === account.id ? !item.isActive : item.isActive
          )
          .map((item) => item.id)
        const result = await activateGoogleAccounts(activeIds)
        setAccounts(result.accounts)
        setLocations([])
        setMessage(
          activeIds.length
            ? "Account selection saved. Refresh locations to continue."
            : "No Google accounts are active."
        )
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Account selection failed."
        )
      }
    })
  }

  function configureNotifications() {
    const activeAccount = accounts.find((account) => account.isActive)
    if (!activeAccount) {
      setMessage("Activate a Google account before configuring notifications.")
      return
    }
    setMessage("")
    startTransition(async () => {
      try {
        await configureGoogleNotifications(activeAccount.id, pubsubTopic)
        setConnections(
          (current) =>
            current?.map((item) =>
              item.id === connection?.id
                ? {
                    ...item,
                    notificationsEnabled: Boolean(pubsubTopic),
                  }
                : item
            ) ?? []
        )
        setMessage(
          pubsubTopic
            ? "NEW_REVIEW and UPDATED_REVIEW notifications enabled."
            : "Google notifications disabled."
        )
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Notification configuration failed."
        )
      }
    })
  }

  function link(location: GoogleLocation) {
    setMessage("")
    startTransition(async () => {
      try {
        const locationId = linkTargets[location.id] || undefined
        const confirmRelink = locationId
          ? window.confirm(
              "Confirm this mapping. If the Google location was linked elsewhere, its historical reviews will move with it without mixing other location data."
            )
          : false
        if (locationId && !confirmRelink) return
        await linkGoogleLocation(location, { locationId, confirmRelink })
        const backfill = location.verified
          ? await runBackfill(location.id)
          : null
        if (backfill) setBackfillProgress(backfill.progress)
        const refreshed = await loadInternalLocations()
        setInternalLocations(refreshed.locations)
        const failed = backfill?.batches.some((batch) => batch.error)
        const complete = backfill?.batches.every((batch) => batch.complete)
        setMessage(
          location.verified && failed
            ? `${location.title ?? location.name} linked, but backfill needs attention.`
            : location.verified && complete
              ? `${location.title ?? location.name} linked and backfilled.`
              : location.verified
                ? `${location.title ?? location.name} linked. Backfill continuation is pending.`
                : `${location.title ?? location.name} linked. Review actions remain blocked until Google marks it verified.`
        )
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Linking failed.")
      }
    })
  }

  function cancelBackfillContinuation(externalLocationId: string) {
    setMessage("")
    startTransition(async () => {
      try {
        const result = await cancelBackfill(externalLocationId)
        setBackfillProgress(result.progress)
        setMessage(
          result.cancelledExternalLocationIds.length
            ? "Backfill continuation cancelled."
            : "No pending backfill continuation was available to cancel."
        )
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Cancellation failed."
        )
      }
    })
  }

  function disconnect() {
    if (!connection) return
    setMessage("")
    startTransition(async () => {
      try {
        await disconnectGoogle(connection.id)
        setConnections(
          (current) =>
            current?.map((item) =>
              item.id === connection.id
                ? { ...item, status: "disconnected" }
                : item
            ) ?? []
        )
        setMessage(
          "Google disconnected. Policy cleanup is scheduled within 7 days."
        )
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Disconnect failed."
        )
      }
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-7 px-5 py-7 md:px-8 md:py-9">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">
          Google connection
        </h1>
        <p className="text-sm text-muted-foreground">
          OAuth access, linked locations and notification health.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <Link2 className="size-5" aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <CardTitle>
                {connection?.googleEmail ??
                  (isPreview ? "ops@lapeninns.co.uk" : "No Google account")}
              </CardTitle>
              <CardDescription>
                {connection
                  ? `Scope: business.manage · connected ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(connection.createdAt))}`
                  : isPreview
                    ? "Scope: business.manage · preview data"
                    : "Connect an authorised Google Business Profile account"}
              </CardDescription>
            </div>
          </div>
          <Badge variant="secondary">
            {connection?.reconnectRequired
              ? "Reconnect required"
              : (connection?.status ??
                (isPreview ? "Preview" : "Not connected"))}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-3">
          <ConnectionMetric
            label="OAuth token"
            value={connection?.status === "active" ? "Healthy" : "Not active"}
            detail={
              connection?.reconnectRequired
                ? `Reconnect task open · ${connection.lastErrorCode ?? "access expired"}`
                : connection?.lastRefreshAt
                  ? `Refreshed ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(connection.lastRefreshAt))}`
                  : isPreview
                    ? "Refreshed 4 minutes ago"
                    : "Awaiting connection"
            }
          />
          <ConnectionMetric
            label="Notifications"
            value={
              connection?.notificationsEnabled
                ? "Active"
                : isPreview
                  ? "Active"
                  : "Not configured"
            }
            detail="NEW_REVIEW, UPDATED_REVIEW"
          />
          <ConnectionMetric
            label="Pub/Sub"
            value="Healthy"
            detail="0 messages in backlog"
          />
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={connection ? discover : connect}
            disabled={isPending}
          >
            <RefreshCw data-icon="inline-start" />
            {connection
              ? accounts.length
                ? "Refresh locations"
                : "Discover accounts"
              : "Connect Google"}
          </Button>
          <Button variant="outline" onClick={connect} disabled={isPending}>
            <ExternalLink data-icon="inline-start" />
            Reconnect OAuth
          </Button>
          <Button
            variant="ghost"
            className="ml-auto text-destructive"
            onClick={disconnect}
            disabled={!connection || isPending}
          >
            <Unplug data-icon="inline-start" />
            Disconnect
          </Button>
        </CardFooter>
      </Card>

      {accounts.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Google accounts</CardTitle>
            <CardDescription>
              Select which accessible accounts this organisation may use.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {account.accountName ?? account.googleAccountName}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {account.googleAccountName} ·{" "}
                    {account.role ?? "unknown role"}
                  </p>
                </div>
                <Button
                  variant={account.isActive ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => toggleAccount(account)}
                  disabled={isPending}
                  aria-pressed={account.isActive}
                >
                  {account.isActive ? "Active" : "Activate"}
                </Button>
              </div>
            ))}
            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row">
              <Input
                value={pubsubTopic}
                onChange={(event) => setPubsubTopic(readControlValue(event))}
                placeholder="projects/project-id/topics/gbp-reviews"
                aria-label="Google Pub/Sub topic"
              />
              <Button
                variant="outline"
                onClick={configureNotifications}
                disabled={isPending}
              >
                Configure notifications
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {backfillProgress?.items.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Historical backfill</CardTitle>
            <CardDescription>
              {backfillProgress.counts.succeeded ?? 0} complete ·{" "}
              {backfillProgress.counts.failed ?? 0} failed ·{" "}
              {(backfillProgress.counts.pending ?? 0) +
                (backfillProgress.counts.running ?? 0)}{" "}
              in progress
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {backfillProgress.items.map((item) => (
              <div
                key={item.externalLocationId}
                className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {item.locationName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.status === "failed"
                      ? `Failed · ${item.lastErrorCode ?? "unknown error"}`
                      : item.status === "pending"
                        ? "More Google pages are queued"
                        : item.status === "succeeded"
                          ? "All review pages imported"
                          : item.status.replace("_", " ")}
                    {item.attemptCount ? ` · attempt ${item.attemptCount}` : ""}
                  </p>
                </div>
                <Badge
                  variant={
                    item.status === "failed" ? "destructive" : "secondary"
                  }
                >
                  {item.status.replace("_", " ")}
                </Badge>
                {item.status === "pending" || item.status === "failed" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      cancelBackfillContinuation(item.externalLocationId)
                    }
                    disabled={isPending}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Linked locations</CardTitle>
          <CardDescription>
            {locations.length
              ? `${locations.length} discovered Google locations`
              : "Google locations mapped to Lapen Inns"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col">
          {locations.length ? (
            <div className="grid gap-2 border-b pb-4 sm:grid-cols-[1fr_180px]">
              <Input
                value={locationQuery}
                onChange={(event) => setLocationQuery(readControlValue(event))}
                placeholder="Filter Google locations"
                aria-label="Filter Google locations"
              />
              <NativeSelect
                value={verificationFilter}
                onValueChange={setVerificationFilter}
                aria-label="Filter by verification state"
              >
                <NativeSelectOption value="all">All states</NativeSelectOption>
                <NativeSelectOption value="verified">
                  Verified
                </NativeSelectOption>
                <NativeSelectOption value="unverified">
                  Unverified
                </NativeSelectOption>
              </NativeSelect>
            </div>
          ) : null}
          {locations.length
            ? locations
                .filter((location) => {
                  const matchesText = (location.title ?? location.name)
                    .toLowerCase()
                    .includes(locationQuery.trim().toLowerCase())
                  const matchesVerification =
                    verificationFilter === "all" ||
                    (verificationFilter === "verified"
                      ? location.verified
                      : !location.verified)
                  return matchesText && matchesVerification
                })
                .map((location, index) => (
                  <div key={location.id}>
                    {index ? <Separator /> : null}
                    <LocationConnection
                      name={location.title ?? location.name}
                      account={`${location.accountName} · ${formatGoogleAddress(location) || location.name}`}
                      status={location.verified ? "Verified" : "Unverified"}
                      sync={
                        location.verified
                          ? "Ready for reviews and replies"
                          : "May be linked; review actions stay blocked"
                      }
                    />
                    <div className="flex flex-col gap-2 pb-4 pl-12 sm:flex-row">
                      <NativeSelect
                        value={linkTargets[location.id] ?? ""}
                        onValueChange={(value) =>
                          setLinkTargets((current) => ({
                            ...current,
                            [location.id]: value,
                          }))
                        }
                        aria-label={`Internal location for ${location.title ?? location.name}`}
                      >
                        <NativeSelectOption value="">
                          Create “{location.title ?? location.name}”
                        </NativeSelectOption>
                        {internalLocations.map((internal) => (
                          <NativeSelectOption
                            key={internal.locationId}
                            value={internal.locationId}
                          >
                            {internal.name}
                            {isLocationCandidate(location, internal)
                              ? " · suggested"
                              : ""}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => link(location)}
                        disabled={isPending}
                      >
                        Link location
                      </Button>
                    </div>
                  </div>
                ))
            : [
                ["London Mayfair", "accounts/4821 · locations/1184", "2m"],
                ["Birmingham NEC", "accounts/4821 · locations/2267", "5m"],
                ["Leeds City", "accounts/4821 · locations/3951", "4m"],
              ].map(([name, account, sync], index) => (
                <div key={name}>
                  {index ? <Separator /> : null}
                  <LocationConnection
                    name={name}
                    account={account}
                    status={isPreview ? "Verified" : "Not discovered"}
                    sync={
                      isPreview ? `Synced ${sync} ago` : "Refresh locations"
                    }
                  />
                </div>
              ))}
        </CardContent>
      </Card>

      {message ? (
        <p className="text-xs text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}

      <Alert>
        <ShieldCheck />
        <AlertTitle>Disconnect control</AlertTitle>
        <AlertDescription>
          Disconnecting immediately stops sync and publishing, then starts the
          policy-compliant disassociation and cleanup workflow.
        </AlertDescription>
      </Alert>
    </div>
  )
}

function ConnectionMetric({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-muted/40 p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  )
}

function LocationConnection({
  name,
  account,
  status,
  sync,
  onLink,
}: {
  name: string
  account: string
  status: string
  sync: string
  onLink?: () => void
}) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
      <span className="flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <CheckCircle2 className="size-4" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium">{name}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {account}
        </p>
      </div>
      <div className="flex items-center gap-2 sm:justify-end">
        <Badge variant="secondary">{status}</Badge>
        <span className="text-xs text-muted-foreground">{sync}</span>
        {onLink ? (
          <Button variant="outline" size="sm" onClick={onLink}>
            Link
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function SettingsView() {
  const [approvalRequired, setApprovalRequired] = useState(true)
  const [retentionDays, setRetentionDays] = useState(30)
  const [defaultLanguage, setDefaultLanguage] = useState("en")
  const [defaultTimezone, setDefaultTimezone] = useState("Europe/London")
  const [directPublishConsent, setDirectPublishConsent] = useState(false)
  const [members, setMembers] = useState<OrganisationMember[]>([])
  const [internalLocations, setInternalLocations] = useState<
    InternalLocation[]
  >([])
  const [newMemberName, setNewMemberName] = useState("")
  const [newMemberEmail, setNewMemberEmail] = useState("")
  const [newMemberRole, setNewMemberRole] =
    useState<OrganisationMember["role"]>("member")
  const [privacySubject, setPrivacySubject] = useState("")
  const [privacyRequestType, setPrivacyRequestType] = useState<
    "access" | "rectification" | "erasure" | "restriction"
  >("access")
  const [message, setMessage] = useState("")
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    let active = true
    void loadSettings()
      .then(({ settings }) => {
        if (!active) return
        setApprovalRequired(settings.approvalRequired)
        setRetentionDays(settings.rawContentRetentionDays)
        setDefaultLanguage(settings.defaultLanguageCode)
        setDefaultTimezone(settings.defaultTimezone)
        setDirectPublishConsent(Boolean(settings.directPublishConsentAt))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all([loadMembers(), loadInternalLocations()])
      .then(([memberResult, locationResult]) => {
        if (!active) return
        setMembers(memberResult.members)
        setInternalLocations(locationResult.locations)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  function persistSettings() {
    setMessage("")
    startTransition(async () => {
      try {
        await saveSettings({
          approvalRequired,
          rawContentRetentionDays: retentionDays,
          defaultLanguageCode: defaultLanguage,
          defaultTimezone,
          directPublishConsent,
        })
        setMessage("Policy settings saved and added to the audit trail.")
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Save failed.")
      }
    })
  }

  function inviteMember() {
    setMessage("")
    startTransition(async () => {
      try {
        const { member } = await addMember({
          email: newMemberEmail,
          displayName: newMemberName,
          role: newMemberRole,
          canPublish: false,
        })
        setMembers((current) => [...current, { ...member, locations: [] }])
        setNewMemberName("")
        setNewMemberEmail("")
        setMessage("Member added. Their access change is in the audit trail.")
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Add member failed."
        )
      }
    })
  }

  function changeMember(
    member: OrganisationMember,
    patch: Pick<OrganisationMember, "role" | "canPublish">
  ) {
    setMessage("")
    startTransition(async () => {
      try {
        await updateMember({ userId: member.userId, ...patch })
        setMembers((current) =>
          current.map((item) =>
            item.userId === member.userId ? { ...item, ...patch } : item
          )
        )
        setMessage("Member role updated.")
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Update failed.")
      }
    })
  }

  function cycleLocationAccess(member: OrganisationMember, locationId: string) {
    const current = member.locations.find(
      (assignment) => assignment.locationId === locationId
    )
    const assignments = current
      ? current.canPublish || member.role === "viewer"
        ? member.locations.filter(
            (assignment) => assignment.locationId !== locationId
          )
        : member.locations.map((assignment) =>
            assignment.locationId === locationId
              ? { ...assignment, canPublish: true }
              : assignment
          )
      : [...member.locations, { locationId, canPublish: false }]
    setMessage("")
    startTransition(async () => {
      try {
        await saveLocationAssignments(member.userId, assignments)
        setMembers((items) =>
          items.map((item) =>
            item.userId === member.userId
              ? { ...item, locations: assignments }
              : item
          )
        )
        setMessage("Location permissions updated.")
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Update failed.")
      }
    })
  }

  function submitPrivacyRequest() {
    setMessage("")
    startTransition(async () => {
      try {
        await createPrivacyRequest({
          requestType: privacyRequestType,
          subjectReference: privacySubject,
          reason: "Submitted from the organisation compliance workspace.",
        })
        setMessage("Privacy request recorded in the immutable audit trail.")
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Privacy request failed."
        )
      }
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-5 py-7 md:px-8 md:py-9">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">
          Reply policy
        </h1>
        <p className="text-sm text-muted-foreground">
          Human approval, verification and retention controls.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Publishing safeguards</CardTitle>
          <CardDescription>
            Defaults apply to every linked location unless overridden.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>Require human approval</FieldTitle>
                <FieldDescription>
                  AI drafts cannot publish until an authorised person approves
                  them.
                </FieldDescription>
              </FieldContent>
              <Switch
                checked={approvalRequired}
                onCheckedChange={(checked) => {
                  setApprovalRequired(checked)
                  if (checked) setDirectPublishConsent(false)
                }}
                aria-label="Require human approval"
              />
            </Field>
            <Separator />
            {!approvalRequired ? (
              <>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>Owner consent for direct publishing</FieldTitle>
                    <FieldDescription>
                      I authorise NabaReview to publish verified replies on this
                      organisation’s behalf without a separate approval step.
                      Every action remains attributable and location-scoped.
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    checked={directPublishConsent}
                    onCheckedChange={setDirectPublishConsent}
                    aria-label="Consent to direct publishing"
                  />
                </Field>
                <Separator />
              </>
            ) : null}
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>Escalate one-star reviews</FieldTitle>
                <FieldDescription>
                  Route serious complaints into the escalation queue.
                </FieldDescription>
              </FieldContent>
              <Switch defaultChecked aria-label="Escalate one-star reviews" />
            </Field>
            <Separator />
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>Block drafts that fail verification</FieldTitle>
                <FieldDescription>
                  Prevent publish when claims, personal data or tone checks
                  fail.
                </FieldDescription>
              </FieldContent>
              <Switch
                defaultChecked
                aria-label="Block drafts that fail verification"
              />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button
            onClick={persistSettings}
            disabled={isPending || (!approvalRequired && !directPublishConsent)}
          >
            Save policy
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team access</CardTitle>
          <CardDescription>
            Roles control administration; location assignments restrict review
            visibility and approval. Click a location to cycle View → Publish →
            No access.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_150px_auto]">
            <Input
              value={newMemberName}
              onChange={(event) => setNewMemberName(readControlValue(event))}
              placeholder="Display name"
              aria-label="New member display name"
            />
            <Input
              value={newMemberEmail}
              onChange={(event) => setNewMemberEmail(readControlValue(event))}
              placeholder="name@example.com"
              type="email"
              aria-label="New member email"
            />
            <NativeSelect
              value={newMemberRole}
              onValueChange={(value) =>
                setNewMemberRole(value as OrganisationMember["role"])
              }
              aria-label="New member role"
            >
              <NativeSelectOption value="admin">Admin</NativeSelectOption>
              <NativeSelectOption value="member">Member</NativeSelectOption>
              <NativeSelectOption value="viewer">Viewer</NativeSelectOption>
            </NativeSelect>
            <Button
              onClick={inviteMember}
              disabled={isPending || !newMemberName || !newMemberEmail}
            >
              Add member
            </Button>
          </div>
          {members.map((member) => (
            <div
              key={member.userId}
              className="flex flex-col gap-3 rounded-xl border p-4"
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-48 flex-1">
                  <p className="text-sm font-medium">{member.displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    {member.email}
                  </p>
                </div>
                <NativeSelect
                  className="w-32"
                  value={member.role}
                  onValueChange={(value) =>
                    changeMember(member, {
                      role: value as OrganisationMember["role"],
                      canPublish: member.canPublish,
                    })
                  }
                  aria-label={`Role for ${member.displayName}`}
                >
                  <NativeSelectOption value="owner">Owner</NativeSelectOption>
                  <NativeSelectOption value="admin">Admin</NativeSelectOption>
                  <NativeSelectOption value="member">Member</NativeSelectOption>
                  <NativeSelectOption value="viewer">Viewer</NativeSelectOption>
                </NativeSelect>
                <label className="flex items-center gap-2 text-xs">
                  Publish all
                  <Switch
                    checked={member.canPublish}
                    disabled={member.role === "viewer"}
                    onCheckedChange={(canPublish) =>
                      changeMember(member, {
                        role: member.role,
                        canPublish,
                      })
                    }
                    aria-label={`Publish all locations for ${member.displayName}`}
                  />
                </label>
              </div>
              {member.role === "member" || member.role === "viewer" ? (
                <div className="flex flex-wrap gap-2">
                  {internalLocations.map((location) => {
                    const assignment = member.locations.find(
                      (item) => item.locationId === location.locationId
                    )
                    return (
                      <Button
                        key={location.locationId}
                        variant={assignment ? "secondary" : "outline"}
                        size="sm"
                        onClick={() =>
                          cycleLocationAccess(member, location.locationId)
                        }
                      >
                        {location.name}
                        {assignment
                          ? assignment.canPublish
                            ? " · Publish"
                            : " · View"
                          : " · No access"}
                      </Button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Language and timezone</CardTitle>
          <CardDescription>
            Dates and fallback drafts use these organisation defaults.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="default-language">
                Default language
              </FieldLabel>
              <NativeSelect
                id="default-language"
                value={defaultLanguage}
                onValueChange={setDefaultLanguage}
              >
                <NativeSelectOption value="en">English</NativeSelectOption>
                <NativeSelectOption value="fr">French</NativeSelectOption>
                <NativeSelectOption value="de">German</NativeSelectOption>
                <NativeSelectOption value="es">Spanish</NativeSelectOption>
                <NativeSelectOption value="it">Italian</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="default-timezone">IANA timezone</FieldLabel>
              <Input
                id="default-timezone"
                value={defaultTimezone}
                onChange={(event) =>
                  setDefaultTimezone(readControlValue(event))
                }
                placeholder="Europe/London"
              />
              <FieldDescription>
                For example Europe/London or America/New_York.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button onClick={persistSettings} disabled={isPending}>
            Save locale
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data retention</CardTitle>
          <CardDescription>
            Separate transient Google content from durable aggregates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="retention-window">
                Raw content window
              </FieldLabel>
              <NativeSelect
                id="retention-window"
                className="w-full"
                value={String(retentionDays)}
                onValueChange={(value) => setRetentionDays(Number(value))}
              >
                <NativeSelectOption value="30">
                  30 days (recommended)
                </NativeSelectOption>
                <NativeSelectOption value="14">14 days</NativeSelectOption>
                <NativeSelectOption value="7">7 days</NativeSelectOption>
              </NativeSelect>
              <FieldDescription>
                Verbatim review text and media metadata are purged
                automatically.
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>Keep derived aggregates</FieldTitle>
                <FieldDescription>
                  Preserve rating, response-time and volume metrics after raw
                  text is purged.
                </FieldDescription>
              </FieldContent>
              <Switch defaultChecked aria-label="Keep derived aggregates" />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            Next purge: 29 Jul 2026, 02:00 UTC
          </span>
          <Button
            variant="outline"
            onClick={() =>
              window.open(
                "/api/audit-log?format=csv&page_size=1000&action=retention.purge.completed",
                "_blank",
                "noopener,noreferrer"
              )
            }
          >
            Review purge log
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compliance tools</CardTitle>
          <CardDescription>
            Track data-subject workflows and export attributable audit records.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="privacy-subject">
                Reviewer name or Google review ID
              </FieldLabel>
              <Input
                id="privacy-subject"
                value={privacySubject}
                onChange={(event) => setPrivacySubject(readControlValue(event))}
                placeholder="Google review ID or exact reviewer name"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="privacy-request-type">
                Request type
              </FieldLabel>
              <NativeSelect
                id="privacy-request-type"
                value={privacyRequestType}
                onValueChange={(value) =>
                  setPrivacyRequestType(value as typeof privacyRequestType)
                }
              >
                <NativeSelectOption value="access">Access</NativeSelectOption>
                <NativeSelectOption value="rectification">
                  Rectification
                </NativeSelectOption>
                <NativeSelectOption value="erasure">Erasure</NativeSelectOption>
                <NativeSelectOption value="restriction">
                  Restriction
                </NativeSelectOption>
              </NativeSelect>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button
            onClick={submitPrivacyRequest}
            disabled={isPending || privacySubject.trim().length < 3}
          >
            Record request
          </Button>
          <Button
            variant="outline"
            disabled={privacySubject.trim().length < 3}
            onClick={() =>
              window.open(
                `/api/privacy/export?subject=${encodeURIComponent(privacySubject)}`,
                "_blank",
                "noopener,noreferrer"
              )
            }
          >
            Export retained data
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              window.open(
                "/api/audit-log?format=csv&page_size=1000",
                "_blank",
                "noopener,noreferrer"
              )
            }
          >
            Export audit CSV
          </Button>
        </CardFooter>
      </Card>

      {message ? (
        <p className="text-xs text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}

      <Alert>
        <Sparkles />
        <AlertTitle>
          {approvalRequired
            ? "Human-supervised by default"
            : "Direct publishing enabled with owner consent"}
        </AlertTitle>
        <AlertDescription>
          {approvalRequired
            ? "Direct publishing remains disabled. Every response is attributable to an authorised user and retained in the audit trail."
            : "Only authorised roles and location grants may publish. Every response still records the actor, verification result and Google outcome."}
        </AlertDescription>
      </Alert>
    </div>
  )
}
