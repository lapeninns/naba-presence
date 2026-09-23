"use client"

import { Building2Icon, Link2OffIcon } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { ClientSelect } from "@/components/performance/client-select"
import { LocationReport } from "@/components/performance/location-report"
import {
  NotInDirectory,
  ReportScope,
} from "@/components/performance/report-scope"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { buttonVariants } from "@/components/ui/button"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs"
import { ReplyPerformanceTab } from "@/components/performance/reply-performance-tab"
import { GooglePerformanceTab } from "@/components/performance/google-performance-tab"
import { KeywordsTab } from "@/components/performance/keywords-tab"
import type { ClientSummary } from "@/lib/contracts/clients"
import { formatNumber } from "@/lib/format"
import { useClients } from "@/lib/queries/use-clients"
import { cn } from "@/lib/utils"

const TABS = [
  { value: "reply", label: "Reply performance", compactLabel: "Replies" },
  { value: "google", label: "Google performance", compactLabel: "Google" },
  { value: "keywords", label: "Keywords", compactLabel: "Keywords" },
] as const

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
 */
export function PerformanceView() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const param = searchParams.get("tab")
  const active: TabValue = isTab(param) ? param : "reply"
  const clientId = searchParams.get("clientId") ?? undefined
  const locationId = searchParams.get("locationId")
  const clients = useClients()
  const items = clients.data?.items ?? []
  const client = clientId
    ? items.find((entry) => entry.id === clientId)
    : undefined

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
    })
  }

  // One location is a different report — its own figures, no client tabs —
  // reached from the workspace and the hub rather than picked here.
  if (locationId) return <LocationReport locationId={locationId} />

  // An id the directory does not hold: say so, never fall back to another
  // client's (or everyone's) figures under that client's name.
  if (clientId && clients.isSuccess && !client) {
    return <NotInDirectory kind="client" />
  }

  const totalLocations = clients.data
    ? items.reduce((sum, entry) => sum + entry.locationCount, 0) +
      clients.data.unassignedLocationCount
    : null
  const caption = client
    ? `${client.name} · ${locationsPhrase(client.locationCount)}`
    : clientId
      ? "Loading client…"
      : totalLocations === null
        ? "All clients"
        : `All clients · ${locationsPhrase(totalLocations)}`
  const empty = client && client.locationCount === 0

  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      {/* The client scope belongs above the tabs: it applies to all three, and
          picking it per tab would let two of them disagree about whose numbers
          are on screen. */}
      <ReportScope
        icon={<Building2Icon />}
        title="Reporting scope"
        caption={caption}
        controls={
          <ClientSelect
            clients={items}
            value={clientId}
            onChange={(next) =>
              replaceParams((params) => {
                if (next) params.set("clientId", next)
                else params.delete("clientId")
              })
            }
          />
        }
      />
      <Tabs value={active} onValueChange={selectTab}>
        {/* `fill`: three equal columns on a phone, the ordinary row from
            `sm`. The rule now lives on TabsList, so any short tab row gets
            the same narrow-screen behaviour without restating it. */}
        <TabsList fill>
          {TABS.map((tab) => (
            <TabsTab key={tab.value} value={tab.value} aria-label={tab.label}>
              <span className="sm:hidden">{tab.compactLabel}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </TabsTab>
          ))}
        </TabsList>
        <TabsPanel value="reply" className="pt-5">
          {empty ? (
            <NoLocationsPanel client={client} />
          ) : (
            <ReplyPerformanceTab clientId={clientId} />
          )}
        </TabsPanel>
        <TabsPanel value="google" className="pt-5">
          {empty ? (
            <NoLocationsPanel client={client} />
          ) : (
            <GooglePerformanceTab clientId={clientId} />
          )}
        </TabsPanel>
        <TabsPanel value="keywords" className="pt-5">
          {empty ? (
            <NoLocationsPanel client={client} />
          ) : (
            <KeywordsTab clientId={clientId} />
          )}
        </TabsPanel>
      </Tabs>
    </div>
  )
}
