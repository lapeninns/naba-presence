"use client"

import { useState } from "react"

import { ChartCard, ChartLegend, ReportingLineChart } from "@/components/ui/chart"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { FetchedAtCaption } from "@/components/reporting/fetched-at-caption"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { StatTile } from "@/components/reporting/stat-tile"
import { RangeSelect } from "@/components/performance/range-select"
import { RefreshGoogleButton } from "@/components/performance/refresh-google-button"
import { useAnalyticsPresence } from "@/lib/queries/use-analytics-presence"
import { humaniseUnavailableReasons } from "@/lib/reporting/unavailable-reasons"
import { IMPRESSION_METRICS, metricLabel, ORDERED_METRICS } from "@/lib/reporting/metric-labels"
import { PRESENCE_RANGES } from "@/lib/reporting/ranges"
import { canTriggerSync } from "@/lib/reporting/sync-permission"
import { useSessionRole } from "@/lib/queries/use-session" // client session hook (Task 1, REV-1)
import { formatDate, formatNumber } from "@/lib/format"

type PresenceRangeId = (typeof PRESENCE_RANGES)[number]["id"]

export function GooglePerformanceTab({ clientId }: { clientId?: string }) {
  const [rangeId, setRangeId] = useState<PresenceRangeId>("28d")
  const role = useSessionRole()
  const presence = useAnalyticsPresence({ range: rangeId, clientId })

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <FetchedAtCaption iso={presence.data?.freshThrough ?? null} timezone="UTC" />
      <div className="flex items-center gap-3">
        <RangeSelect value={rangeId} onChange={setRangeId} options={PRESENCE_RANGES} label="Google performance range" />
        <RefreshGoogleButton kind="performance" canTrigger={canTriggerSync(role)} onDone={() => void presence.refetch()} />
      </div>
    </div>
  )

  if (presence.isPending) return <div className="flex flex-col gap-(--np-gap-section)">{header}<ReportingPanel variant="loading" /></div>
  if (presence.isError) return <div className="flex flex-col gap-(--np-gap-section)">{header}<ReportingPanel variant="error" onRetry={() => void presence.refetch()} /></div>

  const data = presence.data
  const reasons = humaniseUnavailableReasons(data.unavailableReasons)

  // Off flag wins over state: ingestion is switched off for this account.
  const body =
    !data.ingestionEnabled ? (
      <ReportingPanel variant="off" title="Google performance is not switched on" description="Ask an admin to turn this on for your organisation." />
    ) : data.state === "no_link" ? (
      <ReportingPanel variant="empty" title="No linked location" description="Add a Google location to see how it is performing." />
    ) : data.state === "pending" ? (
      <ReportingPanel variant="loading" />
    ) : data.state === "unavailable" ? (
      <Alert variant="warning">
        <AlertTitle>Some figures could not be refreshed</AlertTitle>
        <AlertDescription>{reasons[0] ?? "We will retry automatically."}</AlertDescription>
      </Alert>
    ) : data.state === "empty" ? (
      <ReportingPanel variant="empty" title="No activity yet" description="Google has not reported any visibility data for this window." />
    ) : (
      <div className="flex flex-col gap-(--np-gap-section)">
        <div className="grid gap-(--np-gap-card) sm:grid-cols-2 xl:grid-cols-4">
          {ORDERED_METRICS.map((metric) => (
            <StatTile key={metric} label={metricLabel(metric)} value={formatNumber(data.totals[metric])} />
          ))}
        </div>
        <ChartCard
          title="Views over time"
          description={<ChartLegend items={IMPRESSION_METRICS.map((m, i) => ({ label: metricLabel(m), colorVar: (i + 1) as 1 | 2 | 3 | 4 }))} />}
          state={data.series.length ? "ready" : "empty"}
          emptyLabel="No daily views in this window."
        >
          <ReportingLineChart
            data={data.series.map((point) => ({ date: point.date, ...point.metrics }))}
            xKey="date"
            xTickFormatter={(iso) => formatDate(iso, "UTC")}
            series={IMPRESSION_METRICS.map((m, i) => ({ key: m, label: metricLabel(m), colorVar: (i + 1) as 1 | 2 | 3 | 4 }))}
          />
        </ChartCard>
      </div>
    )

  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      {/* Leading h2 keeps heading order valid before the ChartCard h3 (REV-2). */}
      <h2 className="sr-only">Google performance</h2>
      {header}
      {reasons.length && data.state === "ready" ? (
        <Alert variant="info"><AlertTitle>Heads up</AlertTitle><AlertDescription>{reasons[0]}</AlertDescription></Alert>
      ) : null}
      {body}
    </div>
  )
}
