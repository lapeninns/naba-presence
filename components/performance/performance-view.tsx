"use client"

import { Link2OffIcon } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { ShareReportButton } from "@/components/clients/share-report-dialog"
import { ClientSelect } from "@/components/performance/client-select"
import { LocationReport } from "@/components/performance/location-report"
import { LocationSelect } from "@/components/performance/location-select"
import { RangeSelect } from "@/components/performance/range-select"
import { NotInDirectory } from "@/components/performance/report-scope"
import {
  ReportToolbar,
  reportToolbarFieldProps,
} from "@/components/reporting/report-toolbar"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { buttonVariants } from "@/components/ui/button"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs"
import { ReplyPerformanceTab } from "@/components/performance/reply-performance-tab"
import { GooglePerformanceTab } from "@/components/performance/google-performance-tab"
import { KeywordsTab } from "@/components/performance/keywords-tab"
import type { ClientSummary } from "@/lib/contracts/clients"
import { formatNumber } from "@/lib/format"
import { useClients } from "@/lib/queries/use-clients"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import {
  DEFAULT_RANGES,
  formatPeriod,
  KEYWORD_RANGES,
  parseRange,
  PRESENCE_RANGES,
  REPLY_RANGES,
  resolvedPeriod,
  type ReportTab,
} from "@/lib/reporting/ranges"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"

/**
 * `lead` is what a phone shows; `rest` completes the label from `sm` and is
 * read to screen readers at every width, so the accessible name always
 * starts with the visible words (WCAG 2.5.3 label in name).
 */
const TABS = [
  { value: "reply", lead: "Reply", rest: "performance" },
  { value: "google", lead: "Google", rest: "performance" },
  { value: "keywords", lead: "Keywords", rest: "" },
] as const

/** Each tab's periods; the toolbar offers the active tab's. */
const RANGE_OPTIONS: Record<
  ReportTab,
  ReadonlyArray<{ id: string; label: string }>
> = {
  reply: REPLY_RANGES,
  google: PRESENCE_RANGES,
  keywords: KEYWORD_RANGES,
}

/** The zone a period's dates are told in, as each tab tells them. */
const PERIOD_ZONE: Record<ReportTab, string> = {
  reply: "Europe/London",
  google: "UTC",
  keywords: "UTC",
}

type TabValue = (typeof TABS)[number]["value"]

function isTab(value: string | null): value is TabValue {
  return TABS.some((tab) => tab.value === value)
}

function locationsPhrase(count: number) {
  return `${formatNumber(count)} ${count === 1 ? "location" : "locations"}`
}

/** A client with nothing filed under it: every report would be empty. */
function NoLocationsPanel({ client }: { client: ClientSummary }) {
  return (
    <ReportingPanel
      framed
      titleAs="h2"
      variant="empty"
      icon={<Link2OffIcon />}
      title="No linked location"
      description={`${client.name} has no Google location yet. Add one to see how it is performing.`}
      action={
        <Link
          href={`/clients/${client.id}`}
          className={cn(buttonVariants({ variant: "secondary" }))}
        >
          Open {client.name}
        </Link>
      }
    />
  )
}

/**
 * Three reports, each its own section with its own range, so these stay Tabs
 * rather than a segmented control: they are not three views of one dataset.
 *
 * Everything that decides what is on screen lives in the address: the tab
 * (`?tab=`), the client (`?clientId=`), one location (`?locationId=`) and
 * the period (`?range=`), so a report can be shared, reloaded and gone back
 * to exactly as it was.
 */
export function PerformanceView() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const param = searchParams.get("tab")
  const active: TabValue = isTab(param) ? param : "reply"
  const business = useWorkspaceMode() === "business"
  // A business has no client scope: a stale `?clientId=` is ignored, and the
  // figures are the whole business (its one home client).
  const clientId = business
    ? undefined
    : (searchParams.get("clientId") ?? undefined)
  const locationId = searchParams.get("locationId")
  const rawRange = searchParams.get("range")
  const clients = useClients()
  const role = useSessionRole()
  const directory = useLocationDirectory(role)
  // Sharing shows a client's report to someone outside the organisation,
  // so it is an owner/admin action; the API enforces the same.
  const canShare = role === "owner" || role === "admin"
  const items = clients.data?.items ?? []
  const client = clientId
    ? items.find((entry) => entry.id === clientId)
    : undefined
  const clientLocations = business
    ? (directory.data ?? [])
    : clientId
      ? (directory.data ?? []).filter((entry) => entry.clientId === clientId)
      : []
  // "Share report" shares the business: its home client, whatever it is named.
  const shareClient = business ? items[0] : client

  function replaceParams(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString())
    mutate(params)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  function selectTab(next: string) {
    replaceParams((params) => {
      if (next === "reply") params.delete("tab")
      else params.set("tab", next)
      // A period the next tab does not offer would silently read as its
      // default; drop it so the address says what is on screen.
      if (isTab(next) && parseRange(next, rawRange) !== rawRange) {
        params.delete("range")
      }
    })
  }

  function setRange(tab: ReportTab) {
    return (next: string) =>
      replaceParams((params) => {
        if (next === DEFAULT_RANGES[tab]) params.delete("range")
        else params.set("range", next)
      })
  }

  const activeRange = parseRange(active, rawRange)
  // Day-precision dates, so resolving "now" on each render is stable.
  const periodDates = formatPeriod(
    resolvedPeriod(active, activeRange),
    PERIOD_ZONE[active]
  )

  // One location is a different report — its own figures, no client tabs —
  // reached from the workspace, the hub, or the Location field below.
  if (locationId)
    return (
      <LocationReport
        locationId={locationId}
        // One period for the whole location report, from `?range=` like the
        // tabs; its default (the reply default) is never written.
        rangeId={parseRange("reply", rawRange)}
        onRangeChange={(next) =>
          replaceParams((params) => {
            if (next === DEFAULT_RANGES.reply) params.delete("range")
            else params.set("range", next)
          })
        }
      />
    )

  // An id the directory does not hold: say so, never fall back to another
  // client's (or everyone's) figures under that client's name.
  if (clientId && clients.isSuccess && !client) {
    return <NotInDirectory kind="client" />
  }

  const totalLocations = clients.data
    ? items.reduce((sum, entry) => sum + entry.locationCount, 0) +
      clients.data.unassignedLocationCount
    : null
  const scopeCount = client
    ? client.locationCount
    : clientId
      ? null
      : totalLocations
  const locationsPart =
    scopeCount === null
      ? business
        ? "All locations"
        : "Every location"
      : locationsPhrase(scopeCount)
  const clientPart = client
    ? client.name
    : clientId
      ? clients.isError
        ? "Selected client"
        : "Loading client…"
      : "All clients"
  const periodLabel =
    RANGE_OPTIONS[active].find((option) => option.id === activeRange)?.label ??
    ""
  const empty = client && client.locationCount === 0

  return (
    // Browser "Save as PDF": controls drop out, figures and charts stay whole.
    <div className="flex flex-col gap-(--np-gap-section) print:gap-6 print:[&_button]:hidden print:[&_figure]:break-inside-avoid print:[&_section]:break-inside-avoid">
      {/* One row above the tabs: the scope and the period apply to the tab on
          screen, and picking the client per tab would let two of them
          disagree about whose numbers are shown. */}
      <ReportToolbar
        summary={
          business
            ? [locationsPart, periodLabel]
            : [clientPart, locationsPart, periodLabel]
        }
        meta={
          [scopeCount === null ? null : locationsPart, periodDates]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        fields={(placement) => {
          const field = reportToolbarFieldProps(placement)
          return (
            <>
              {business ? null : (
                <ClientSelect
                  {...field}
                  clients={items}
                  value={clientId}
                  onChange={(next) =>
                    replaceParams((params) => {
                      if (next) params.set("clientId", next)
                      else params.delete("clientId")
                    })
                  }
                />
              )}
              {business || client ? (
                <LocationSelect
                  {...field}
                  locations={clientLocations}
                  value={undefined}
                  onChange={(next) =>
                    replaceParams((params) => {
                      if (next) params.set("locationId", next)
                      else params.delete("locationId")
                    })
                  }
                />
              ) : null}
              <RangeSelect
                {...field}
                className={placement === "bar" ? "w-44" : field.className}
                value={activeRange}
                onChange={setRange(active)}
                options={RANGE_OPTIONS[active]}
                // In the bar the dates sit in the caption beside the fields.
                period={placement === "sheet" ? periodDates : undefined}
              />
            </>
          )
        }}
        actions={
          shareClient && canShare ? (
            <ShareReportButton
              clientId={shareClient.id}
              clientName={shareClient.name}
            />
          ) : null
        }
      />
      {clients.isError ? (
        // The figures below are still scoped by the address; only the
        // client names and the picker are missing.
        <ReportingPanel
          variant="error"
          title={
            business
              ? "We couldn’t load your locations"
              : "We couldn’t load your clients"
          }
          cause={clients.error}
          onRetry={() => void clients.refetch()}
        />
      ) : null}
      <Tabs value={active} onValueChange={selectTab}>
        {/* Notion Mail text tabs: plain labels, the current one 600 ink with
            a 2px ink underline; still 44px tall on touch. `fill`: three
            equal columns on a phone, the ordinary row from `sm`. */}
        <TabsList fill variant="text">
          {TABS.map((tab) => (
            <TabsTab key={tab.value} value={tab.value}>
              {tab.lead}
              {tab.rest ? (
                <>
                  {" "}
                  <span className="sr-only sm:not-sr-only">{tab.rest}</span>
                </>
              ) : null}
            </TabsTab>
          ))}
        </TabsList>
        <TabsPanel value="reply" className="pt-5">
          {empty ? (
            <NoLocationsPanel client={client} />
          ) : (
            <ReplyPerformanceTab
              clientId={clientId}
              range={parseRange("reply", rawRange)}
              onRangeChange={setRange("reply")}
            />
          )}
        </TabsPanel>
        <TabsPanel value="google" className="pt-5">
          {empty ? (
            <NoLocationsPanel client={client} />
          ) : (
            <GooglePerformanceTab
              clientId={clientId}
              range={parseRange("google", rawRange)}
              onRangeChange={setRange("google")}
            />
          )}
        </TabsPanel>
        <TabsPanel value="keywords" className="pt-5">
          {empty ? (
            <NoLocationsPanel client={client} />
          ) : (
            <KeywordsTab
              clientId={clientId}
              range={parseRange("keywords", rawRange)}
            />
          )}
        </TabsPanel>
      </Tabs>
    </div>
  )
}
