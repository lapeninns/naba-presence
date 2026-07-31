"use client"

import {
  CalendarClock,
  CarFront,
  Globe2,
  Map,
  MessageCircle,
  Phone,
  Search,
  ShoppingBag,
  Utensils,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
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
  type ChartConfig,
} from "@/components/ui/chart"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  EmptyData,
  LiveDataError,
  MetricCard,
} from "@/components/naba-presence/shared"
import {
  loadPresenceAnalytics,
  loadPresenceKeywords,
  type PresenceAnalytics,
  type PresenceKeywordAnalytics,
  type PresenceMetric,
} from "@/lib/naba-presence-api"

const chartConfig = {
  search: { label: "Search impressions", color: "var(--chart-1)" },
  maps: { label: "Maps impressions", color: "var(--chart-4)" },
} satisfies ChartConfig

const zeroTotals = (metric: PresenceMetric) => metric

function total(data: PresenceAnalytics, ...metrics: PresenceMetric[]) {
  return metrics.reduce((sum, metric) => sum + data.totals[metric], 0)
}

function stateMessage(state: PresenceAnalytics["state"]) {
  if (state === "no_link") return "Link a Google location to begin collecting performance metrics."
  if (state === "pending") return "The first Google performance sync is queued. Metrics will appear after it completes."
  if (state === "unavailable") return "Google performance metrics are unavailable for this location. Check verification and connection access."
  return "Google returned no performance activity for this date range."
}

export function PresenceAnalyticsView({
  locationId,
}: {
  locationId?: string
}) {
  const [range, setRange] = useState<PresenceAnalytics["range"]>("28d")
  const [selectedLocationId, setSelectedLocationId] = useState(locationId ?? "")
  const [data, setData] = useState<PresenceAnalytics | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [reloadKey, setReloadKey] = useState(0)
  const [keywordData, setKeywordData] =
    useState<PresenceKeywordAnalytics | null>(null)
  const [keywordStatus, setKeywordStatus] =
    useState<"idle" | "loading" | "ready" | "error">("idle")

  useEffect(() => {
    let active = true
    void loadPresenceAnalytics({
      range,
      locationId: (locationId ?? selectedLocationId) || undefined,
    })
      .then((next) => {
        if (!active) return
        setData(next)
        setStatus("ready")
      })
      .catch(() => {
        if (active) setStatus("error")
      })
    return () => {
      active = false
    }
  }, [locationId, range, reloadKey, selectedLocationId])

  useEffect(() => {
    if (!data?.keywordsEnabled) return
    let active = true
    const keywordRange: PresenceKeywordAnalytics["range"] =
      range === "28d"
        ? "1m"
        : range === "90d"
          ? "6m"
          : range === "12m"
            ? "12m"
            : "18m"
    void loadPresenceKeywords({
      range: keywordRange,
      locationId: (locationId ?? selectedLocationId) || undefined,
    })
      .then((next) => {
        if (!active) return
        setKeywordData(next)
        setKeywordStatus("ready")
      })
      .catch(() => {
        if (active) setKeywordStatus("error")
      })
    return () => {
      active = false
    }
  }, [data?.keywordsEnabled, locationId, range, reloadKey, selectedLocationId])

  const chartData = useMemo(
    () =>
      data?.series.map((point) => ({
        date: new Intl.DateTimeFormat("en-GB", {
          day: "numeric",
          month: "short",
          year: range === "12m" || range === "18m" ? "2-digit" : undefined,
          timeZone: "UTC",
        }).format(new Date(`${point.date}T00:00:00Z`)),
        search:
          (point.metrics.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH ?? 0) +
          (point.metrics.BUSINESS_IMPRESSIONS_MOBILE_SEARCH ?? 0),
        maps:
          (point.metrics.BUSINESS_IMPRESSIONS_DESKTOP_MAPS ?? 0) +
          (point.metrics.BUSINESS_IMPRESSIONS_MOBILE_MAPS ?? 0),
      })) ?? [],
    [data, range]
  )

  function beginLoad() {
    setData(null)
    setStatus("loading")
  }

  if (status === "error") {
    return (
      <LiveDataError
        onRetry={() => {
          beginLoad()
          setReloadKey((value) => value + 1)
        }}
      />
    )
  }

  const searchImpressions = data
    ? total(
        data,
        "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
        "BUSINESS_IMPRESSIONS_MOBILE_SEARCH"
      )
    : 0
  const mapsImpressions = data
    ? total(
        data,
        "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
        "BUSINESS_IMPRESSIONS_MOBILE_MAPS"
      )
    : 0
  const optionalMetrics = data
    ? [
        { metric: zeroTotals("BUSINESS_CONVERSATIONS"), title: "Conversations", icon: MessageCircle },
        { metric: zeroTotals("BUSINESS_BOOKINGS"), title: "Bookings", icon: CalendarClock },
        { metric: zeroTotals("BUSINESS_FOOD_ORDERS"), title: "Food orders", icon: ShoppingBag },
        { metric: zeroTotals("BUSINESS_FOOD_MENU_CLICKS"), title: "Menu clicks", icon: Utensils },
      ].filter((item) => data.totals[item.metric] > 0)
    : []

  return (
    <section className="flex flex-col gap-(--nr-gap-section)" aria-label="Google performance">
      <div className="flex flex-wrap justify-end gap-2">
        {!locationId && data && data.locations.length > 1 ? (
          <NativeSelect
            size="sm"
            value={selectedLocationId}
            aria-label="Performance location"
            onValueChange={(value) => {
              beginLoad()
              setSelectedLocationId(value)
            }}
          >
            <NativeSelectOption value="">All locations</NativeSelectOption>
            {data.locations.map((location) => (
              <NativeSelectOption key={location.id} value={location.id}>
                {location.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : null}
        <NativeSelect
          size="sm"
          value={range}
          aria-label="Performance date range"
          onValueChange={(value) => {
            beginLoad()
            setRange(value as PresenceAnalytics["range"])
          }}
        >
          <NativeSelectOption value="28d">Last 28 days</NativeSelectOption>
          <NativeSelectOption value="90d">Last 90 days</NativeSelectOption>
          <NativeSelectOption value="12m">Last 12 months</NativeSelectOption>
          <NativeSelectOption value="18m">Last 18 months</NativeSelectOption>
        </NativeSelect>
      </div>

      <Alert>
        <CalendarClock />
        <AlertTitle>Google reporting delay</AlertTitle>
        <AlertDescription>
          Google reports these metrics with a few days&apos; delay.
          {data?.freshThrough ? ` Data through ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${data.freshThrough}T00:00:00Z`))}.` : ""}
        </AlertDescription>
      </Alert>

      {data && !data.ingestionEnabled ? (
        <Alert>
          <CalendarClock />
          <AlertTitle>Performance ingestion is paused</AlertTitle>
          <AlertDescription>Previously collected metrics remain available. New Google reporting data will not be ingested until the Performance control is enabled.</AlertDescription>
        </Alert>
      ) : null}

      {status === "loading" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-32" />
          ))}
        </div>
      ) : data && data.state !== "ready" ? (
        <Card>
          <CardContent>
            <EmptyData message={stateMessage(data.state)} />
          </CardContent>
        </Card>
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Search impressions" value={searchImpressions.toLocaleString()} detail="Desktop and mobile Search" icon={Search} />
            <MetricCard title="Maps impressions" value={mapsImpressions.toLocaleString()} detail="Desktop and mobile Maps" icon={Map} />
            <MetricCard title="Calls" value={data.totals.CALL_CLICKS.toLocaleString()} detail="Call button clicks" icon={Phone} />
            <MetricCard title="Website clicks" value={data.totals.WEBSITE_CLICKS.toLocaleString()} detail="Website button clicks" icon={Globe2} />
            <MetricCard title="Direction requests" value={data.totals.BUSINESS_DIRECTION_REQUESTS.toLocaleString()} detail="Requests for directions" icon={CarFront} />
            {optionalMetrics.map((item) => (
              <MetricCard key={item.metric} title={item.title} value={data.totals[item.metric].toLocaleString()} detail="Google profile actions" icon={item.icon} />
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Profile discovery</CardTitle>
              <CardDescription>Daily Search and Maps impressions reported by Google</CardDescription>
            </CardHeader>
            <CardContent>
              {chartData.length ? (
                <ChartContainer config={chartConfig} className="h-[300px] w-full" initialDimension={{ width: 960, height: 300 }}>
                  <AreaChart accessibilityLayer data={chartData} margin={{ left: -18, right: 10, top: 10 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} minTickGap={28} />
                    <YAxis tickLine={false} axisLine={false} width={44} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
                    <Area dataKey="search" type="monotone" fill="var(--color-search)" fillOpacity={0.12} stroke="var(--color-search)" strokeWidth={2} />
                    <Area dataKey="maps" type="monotone" fill="var(--color-maps)" fillOpacity={0.08} stroke="var(--color-maps)" strokeWidth={2} />
                  </AreaChart>
                </ChartContainer>
              ) : (
                <EmptyData message="No impression series exists for this date range." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Search keywords</CardTitle>
              <CardDescription>
                Search terms people used to find the selected profile, aggregated monthly by Google
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!data.keywordsEnabled ? (
                <Alert>
                  <Search />
                  <AlertTitle>Search-keyword reporting is paused</AlertTitle>
                  <AlertDescription>
                    Daily performance remains available. Keyword ingestion stays fail closed until its Google capability is certified and enabled.
                  </AlertDescription>
                </Alert>
              ) : keywordStatus === "loading" || keywordStatus === "idle" ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }, (_, index) => (
                    <Skeleton key={index} className="h-10 w-full" />
                  ))}
                </div>
              ) : keywordStatus === "error" ? (
                <Alert variant="destructive">
                  <Search />
                  <AlertTitle>Keywords could not be loaded</AlertTitle>
                  <AlertDescription>
                    Daily performance is unaffected. Retry this page after checking the keyword sync status.
                  </AlertDescription>
                </Alert>
              ) : keywordData?.state !== "ready" ? (
                <EmptyData
                  message={
                    keywordData?.state === "pending"
                      ? "The first monthly keyword backfill is queued."
                      : keywordData?.state === "unavailable"
                        ? "Google search keywords are unavailable for this location."
                        : keywordData?.state === "no_link"
                          ? "Link a Google location to collect search keywords."
                          : "Google returned no search keywords for this period."
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Rank</TableHead>
                      <TableHead>Search term</TableHead>
                      <TableHead className="text-right">Impressions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keywordData.keywords.slice(0, 25).map((keyword) => (
                      <TableRow key={keyword.keyword}>
                        <TableCell className="font-mono text-muted-foreground">
                          {keyword.rank}
                        </TableCell>
                        <TableCell className="whitespace-normal font-medium">
                          {keyword.keyword}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {keyword.thresholded
                            ? `<${keyword.upperBound.toLocaleString()}`
                            : keyword.impressions.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Accessible data summary</CardTitle>
              <CardDescription>Text equivalent for the selected Google performance window</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-muted-foreground">Total impressions</dt><dd className="font-mono text-lg">{(searchImpressions + mapsImpressions).toLocaleString()}</dd></div>
                <div><dt className="text-muted-foreground">Profile actions</dt><dd className="font-mono text-lg">{total(data, "CALL_CLICKS", "WEBSITE_CLICKS", "BUSINESS_DIRECTION_REQUESTS").toLocaleString()}</dd></div>
                <div><dt className="text-muted-foreground">From</dt><dd>{data.from}</dd></div>
                <div><dt className="text-muted-foreground">Through</dt><dd>{data.freshThrough ?? "Pending"}</dd></div>
              </dl>
            </CardContent>
          </Card>
        </>
      ) : null}
    </section>
  )
}
