"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { formatStorefrontAddress } from "@/components/naba-presence/locations-index-view"
import {
  BusinessContext,
  LiveDataError,
  PageFrame,
} from "@/components/naba-presence/shared"
import { Badge } from "@/components/ui/badge"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  type GoogleConnection,
  type InternalLocation,
  loadConnections,
  loadInternalLocations,
} from "@/lib/naba-presence-api"
import { cn } from "@/lib/utils"

const TABS = [
  { segment: "", label: "Profile" },
  { segment: "hours", label: "Hours" },
  { segment: "reviews", label: "Reviews" },
  { segment: "photos", label: "Photos" },
  { segment: "posts", label: "Posts" },
  { segment: "menu", label: "Menu" },
  { segment: "qa", label: "Q&A" },
  { segment: "booking", label: "Booking" },
  { segment: "performance", label: "Performance" },
]

export function LocationWorkspace({
  locationId,
  children,
}: {
  locationId: string
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [locations, setLocations] = useState<InternalLocation[]>([])
  const [connections, setConnections] = useState<GoogleConnection[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  )
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    void Promise.all([loadInternalLocations(), loadConnections()])
      .then(([locationResult, connectionResult]) => {
        if (!active) return
        setLocations(locationResult.locations)
        setConnections(connectionResult.connections)
        setStatus("ready")
      })
      .catch(() => {
        if (active) setStatus("error")
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  const current = locations.find(
    (location) => location.locationId === locationId
  )
  const connection =
    connections.find((item) => item.status === "active") ?? connections[0]
  const base = `/locations/${locationId}`
  const activeSegment = pathname.startsWith(base)
    ? pathname.slice(base.length).replace(/^\//, "")
    : ""

  return (
    <PageFrame width="wide">
      {status === "loading" ? (
        <Skeleton className="h-20 w-full" />
      ) : status === "error" ? (
        <LiveDataError
          onRetry={() => {
            setStatus("loading")
            setReloadKey((value) => value + 1)
          }}
        />
      ) : (
        <BusinessContext
          name={current?.name ?? "—"}
          detail={
            <span className="flex flex-col gap-1">
              <span>{formatStorefrontAddress(current?.address ?? null)}</span>
              <span className="flex flex-wrap gap-1.5">
                {current?.linkId ? (
                  <Badge variant="secondary">Linked</Badge>
                ) : (
                  <Badge variant="outline">Not linked</Badge>
                )}
                {current?.verified ? (
                  <Badge variant="secondary">Verified</Badge>
                ) : null}
                {connection?.reconnectRequired ? (
                  <Badge variant="destructive">Reconnect required</Badge>
                ) : null}
              </span>
            </span>
          }
          status={
            locations.length > 1
              ? { label: "Location", value: `${locations.length} total` }
              : undefined
          }
        />
      )}

      {status === "ready" && locations.length > 1 ? (
        <Combobox
          items={locations}
          itemToStringValue={(location) => location.name}
          value={current ?? null}
          onValueChange={(next) => {
            if (next) {
              router.push(
                `/locations/${next.locationId}${activeSegment ? `/${activeSegment}` : ""}`
              )
            }
          }}
        >
          <ComboboxInput
            placeholder="Switch location"
            aria-label="Switch location"
            className="max-w-sm"
            showTrigger={false}
          />
          <ComboboxContent>
            <ComboboxEmpty>No locations found.</ComboboxEmpty>
            <ComboboxList>
              {(item: InternalLocation) => (
                <ComboboxItem key={item.locationId} value={item}>
                  {item.name}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      ) : null}

      <nav aria-label="Location sections" className="overflow-x-auto">
        <ul className="flex min-w-max gap-1">
          {TABS.map((tab) => {
            const href = tab.segment ? `${base}/${tab.segment}` : base
            const isActive = activeSegment === tab.segment
            return (
              <li key={tab.label}>
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center rounded-(--nr-radius-chip) px-3 py-1.5 text-[13px] font-medium transition-colors",
                    isActive
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:bg-secondary/60"
                  )}
                >
                  {tab.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {children}
    </PageFrame>
  )
}
