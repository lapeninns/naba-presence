"use client"

import { Link2OffIcon } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { ClientSelect } from "@/components/performance/client-select"
import { LocationReport } from "@/components/performance/location-report"
import { LocationSelect } from "@/components/performance/location-select"
import { RangeSelect } from "@/components/performance/range-select"
import { NotInDirectory } from "@/components/performance/report-scope"
import { useScopeLabel } from "@/components/app-shell/client-switcher"
import {
  ReportActionsMenu,
  type ReportShareTarget,
} from "@/components/reporting/report-actions-menu"
import {
  ReportPeriodStrip,
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
  formatPeriod,
  KEYWORD_RANGES,
  PRESENCE_RANGES,
  REPLY_RANGES,
  periodToWriteOnTabSwitch,
  resolvedPeriod,
  resolveTabRange,
  type ReportTab,
} from "@/lib/reporting/ranges"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"
import { LISTING_TERMS, workspaceTerms } from "@/lib/workspace/terms"

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

/** Each tab's periods; the period strip and toolbar offer the active tab's. */
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

/**
 * "3 listings", or "3 locations" in a business workspace, where the access
 * scope is the location (`workspaceTerms`).
 */
function scopeCountPhrase(count: number, business: boolean) {
  const terms = workspaceTerms(business ? "business" : "agency")
  const [one, many] = business
    ? [terms.scope, terms.scopePlural]
    : [terms.place, terms.placePlural]
  return `${formatNumber(count)} ${count === 1 ? one : many}`
}

/**
 * A client with nothing filed under it: every report would be empty. Share
 * stays reachable (it was in the toolbar whatever the tab showed): the
 * tabs carry it in their own actions menu, which this panel replaces.
 */
function NoLocationsPanel({
  client,
  share,
}: {
  client: ClientSummary
  share: ReportShareTarget | null
}) {
  return (
    <div className="flex flex-col gap-3">
      {share ? (
        <div className="flex justify-end">
          <ReportActionsMenu share={share} />
        </div>
      ) : null}
      <ReportingPanel
        framed
        titleAs="h2"
        variant="empty"
        icon={<Link2OffIcon />}
        title={`No linked ${LISTING_TERMS.place}`}
        description={`${client.name} has no Google ${LISTING_TERMS.place} yet. Add one to see how it is performing.`}
        action={
          <Link
            href={`/clients/${client.id}`}
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            Open {client.name}
          </Link>
        }
      />
    </div>
  )
}

/**
 * Three reports, each its own section with its own range, so these stay Tabs
 * rather than a segmented control: they are not three views of one dataset.
 *
 * Everything that decides what is on screen lives in the address: the tab
 * (`?tab=`), the client (`?clientId=`), one location (`?locationId=`) and
 * the period (`?range=` for Reply and Google, which share one, and
 * `?range_kw=` for Keywords), so a report can be shared, reloaded and gone
 * back to exactly as it was. Each tab keeps its own last choice, so
 * switching tab never changes a period; a tab with no choice of its own
 * takes the nearest equivalent of the other's and says so.
 *
 * The client and location are chosen in the app bar's scope chip on a phone
 * (the same scope control as every other page) and in the inline fields
 * from `md`; the period is a one-tap chip strip under the tabs on a phone.
 */
export function PerformanceView({
  windowNow,
}: {
  /**
   * The server's "now" (ISO), when it read the Reply tab's figures for this
   * address: the tab resolves its windows from it so its query keys are the
   * ones the server stored them under.
   */
  windowNow?: string
} = {}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const param = searchParams.get("tab")
  const active: TabValue = isTab(param) ? param : "reply"
  const mode = useWorkspaceMode()
  const business = mode === "business"
  const terms = workspaceTerms(mode)
  const scope = useScopeLabel(mode)
  // A business has no client scope: a stale `?clientId=` is ignored, and the
  // figures are the whole business (its one home client).
  const clientId = business
    ? undefined
    : (searchParams.get("clientId") ?? undefined)
  const locationId = searchParams.get("locationId")
  const rawRange = searchParams.get("range")
  const rawRangeKw = searchParams.get("range_kw")
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
  // "Share report" shares the business: its home client, whatever it is
  // named. With every client in scope the menu asks which one first.
  const shareClient = business ? items[0] : client
  const shareTarget: ReportShareTarget | null = !canShare
    ? null
    : shareClient
      ? {
          kind: "client",
          clientId: shareClient.id,
          clientName: shareClient.name,
        }
      : !business && !clientId && items.length > 0
        ? { kind: "pick" }
        : null

  function replaceParams(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString())
    mutate(params)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  function selectTab(next: string) {
    replaceParams((params) => {
      // Only the tab changes: each tab keeps its own period in the address.
      if (next === "reply") params.delete("tab")
      else params.set("tab", next)
      // The period on screen is carried the same whatever the click history
      // (see periodToWriteOnTabSwitch).
      if (isTab(next)) {
        const carried = periodToWriteOnTabSwitch(active, next, rangeParams)
        if (carried) params.set(carried.name, carried.value)
      }
    })
  }

  /**
   * A tab's period is always written to its own parameter, the default
   * included: leaving the default out would make another tab fall back to
   * its own period with no word ("28 days" chosen again after 90 days must
   * still carry to Keywords as one month, with its note).
   */
  function setRange(tab: ReportTab) {
    return (next: string) =>
      replaceParams((params) => {
        params.set(tab === "keywords" ? "range_kw" : "range", next)
      })
  }

  const rangeParams = { range: rawRange, rangeKw: rawRangeKw }
  const activePeriod = resolveTabRange(active, rangeParams)
  // Day-precision dates, so resolving "now" on each render is stable.
  const periodDates = formatPeriod(
    resolvedPeriod(active, activePeriod.id),
    PERIOD_ZONE[active]
  )

  // The app bar's scope chip is the phone's scope control, but it hides
  // itself when there is only one client to switch between. Then the report
  // keeps its own fields on a phone, or a client (and a location under it)
  // could not be chosen at all.
  const phoneScope = !business && scope.ready && !scope.visible

  // One location is a different report — its own figures, no client tabs —
  // reached from the workspace, the hub, or the Location field below.
  if (locationId)
    return (
      <LocationReport
        locationId={locationId}
        // One period for the whole location report: the Reply tab's, from the
        // same address, so it never shows a different window to the tab it
        // sits beside.
        rangeId={resolveTabRange("reply", rangeParams).id}
        rangeNote={resolveTabRange("reply", rangeParams).note}
        onRangeChange={setRange("reply")}
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
        ? `All ${terms.scopePlural}`
        : `Every ${terms.place}`
      : scopeCountPhrase(scopeCount, business)
  const clientPart = client
    ? client.name
    : clientId
      ? clients.isError
        ? "Selected client"
        : "Loading client…"
      : "All clients"
  const periodLabel =
    RANGE_OPTIONS[active].find((option) => option.id === activePeriod.id)
      ?.label ?? ""
  const empty = client && client.locationCount === 0

  return (
    // Browser "Save as PDF": controls drop out, figures and charts stay whole.
    <div className="flex flex-col gap-(--np-gap-section) print:gap-6 print:[&_button]:hidden print:[&_figure]:break-inside-avoid print:[&_section]:break-inside-avoid">
      {/* From `md`, one row above the tabs: the scope and the period apply to
          the tab on screen, and picking the client per tab would let two of
          them disagree about whose numbers are shown. On a phone the scope
          is the app bar's chip and the period is the strip under the tabs. */}
      <ReportToolbar
        phone={phoneScope}
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
        fields={() => {
          const field = reportToolbarFieldProps()
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
                className="w-44 max-md:hidden"
                value={activePeriod.id}
                onChange={setRange(active)}
                options={RANGE_OPTIONS[active]}
                // The dates sit in the caption beside the fields.
              />
            </>
          )
        }}
      />
      {clients.isError ? (
        // The figures below are still scoped by the address; only the
        // client names and the picker are missing.
        <ReportingPanel
          variant="error"
          title={`We couldn’t load your ${terms.scopePlural}`}
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
        {/* One tap to change the period; a line says when it was carried over
            from another tab as its nearest equivalent. */}
        <ReportPeriodStrip
          className="pt-3 md:pt-0"
          value={activePeriod.id}
          options={RANGE_OPTIONS[active]}
          onChange={setRange(active)}
          note={activePeriod.note}
        />
        <TabsPanel value="reply" className="pt-3 md:pt-5">
          {empty ? (
            <NoLocationsPanel client={client} share={shareTarget} />
          ) : (
            <ReplyPerformanceTab
              windowNow={windowNow}
              clientId={clientId}
              range={resolveTabRange("reply", rangeParams).id}
              onRangeChange={setRange("reply")}
              share={shareTarget}
            />
          )}
        </TabsPanel>
        <TabsPanel value="google" className="pt-3 md:pt-5">
          {empty ? (
            <NoLocationsPanel client={client} share={shareTarget} />
          ) : (
            <GooglePerformanceTab
              clientId={clientId}
              range={resolveTabRange("google", rangeParams).id}
              onRangeChange={setRange("google")}
              share={shareTarget}
            />
          )}
        </TabsPanel>
        <TabsPanel value="keywords" className="pt-3 md:pt-5">
          {empty ? (
            <NoLocationsPanel client={client} share={shareTarget} />
          ) : (
            <KeywordsTab
              clientId={clientId}
              range={resolveTabRange("keywords", rangeParams).id}
              share={shareTarget}
            />
          )}
        </TabsPanel>
      </Tabs>
    </div>
  )
}
