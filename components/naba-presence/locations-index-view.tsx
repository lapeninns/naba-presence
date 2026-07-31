"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import {
  EmptyData,
  LiveDataError,
  PageFrame,
  PageHeader,
} from "@/components/naba-presence/shared"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
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
  type AnalyticsOverview,
  type InternalLocation,
  loadAnalytics,
  loadInternalLocations,
  type StorefrontAddress,
} from "@/lib/naba-presence-api"

export function formatStorefrontAddress(
  address: StorefrontAddress | null
): string {
  if (!address) return "—"

  const parts = [
    ...(address.addressLines ?? []),
    address.locality,
    address.administrativeArea,
    address.postalCode,
  ].filter((part): part is string => Boolean(part && part.trim()))

  return parts.length ? parts.join(", ") : "—"
}

export function LocationsIndexView() {
  const [locations, setLocations] = useState<InternalLocation[]>([])
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  )
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    const to = new Date()
    const from = new Date(to.getTime() - 30 * 86_400_000)

    void Promise.all([
      loadInternalLocations(),
      loadAnalytics({
        from: from.toISOString(),
        to: to.toISOString(),
        granularity: "day",
      }),
    ])
      .then(([locationResult, analyticsResult]) => {
        if (!active) return

        setLocations(locationResult.locations)
        setAnalytics(analyticsResult)
        setStatus("ready")
      })
      .catch(() => {
        if (active) setStatus("error")
      })

    return () => {
      active = false
    }
  }, [reloadKey])

  function retry() {
    setStatus("loading")
    setReloadKey((value) => value + 1)
  }

  const metricsById = new Map(
    (analytics?.locations ?? []).map((entry) => [entry.id, entry])
  )

  return (
    <PageFrame width="wide">
      <PageHeader
        title="Locations"
        description="Every location in this organisation and the state of its Google link."
      />

      {status === "error" ? (
        <LiveDataError onRetry={retry} />
      ) : (
        <Card>
          <CardContent>
            {status === "loading" ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : locations.length ? (
              <Table className="min-w-[720px]" tabIndex={0}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Location</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Rating</TableHead>
                    <TableHead className="text-right">Needs reply</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {locations.map((location) => {
                    const metrics = metricsById.get(location.locationId)

                    return (
                      <TableRow key={location.locationId}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/locations/${location.locationId}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {location.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatStorefrontAddress(location.address)}
                        </TableCell>
                        <TableCell>
                          {location.linkId ? (
                            location.verified ? (
                              <Badge variant="secondary">Linked</Badge>
                            ) : (
                              <Badge variant="outline">Unverified</Badge>
                            )
                          ) : (
                            <Badge variant="outline">Not linked</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {metrics?.averageRating === null ||
                          metrics === undefined
                            ? "—"
                            : metrics.averageRating.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {metrics ? metrics.unresolvedComplaints : "—"}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            ) : (
              <EmptyData message="No locations exist yet. Connect Google and link a verified location to begin." />
            )}
          </CardContent>
        </Card>
      )}
    </PageFrame>
  )
}
