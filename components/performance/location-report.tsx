"use client"

import { MapPinIcon } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { LocationPerformance } from "@/components/performance/location-performance"
import { LocationSelect } from "@/components/performance/location-select"
import {
  NotInDirectory,
  ReportScope,
} from "@/components/performance/report-scope"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"

/**
 * Reports scoped to one location.
 *
 * Performance used to be a tenth tab of the location workspace, which made a
 * report look like an editor. It is the same figures, reached from the
 * workspace, the client hub and the report's own Location field through
 * `?locationId=`, under a scope bar that names the location, switches to its
 * client's other locations and offers the way back to the whole client.
 */
function LocationReport({ locationId }: { locationId: string }) {
  const directory = useLocationDirectory(useSessionRole())
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const location = directory.data?.find((entry) => entry.id === locationId)

  if (directory.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-(--np-gap-section)">
        <p role="status" className="sr-only">
          Loading this location’s report
        </p>
        <Skeleton className="h-17 w-full rounded-(--np-radius-card)" />
        <Skeleton className="h-40 w-full rounded-(--np-radius-card)" />
      </div>
    )
  }

  // A failed directory is not "this location isn't yours".
  if (directory.isError) {
    return (
      <ReportingPanel
        variant="error"
        title="We couldn’t load this location"
        cause={directory.error}
        onRetry={() => void directory.refetch()}
      />
    )
  }

  if (!location) return <NotInDirectory kind="location" />

  const siblings = location.clientId
    ? (directory.data ?? []).filter(
        (entry) => entry.clientId === location.clientId
      )
    : []

  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      <ReportScope
        icon={<MapPinIcon />}
        title={`Reporting on ${location.name}`}
        caption={
          location.clientName
            ? `${location.clientName} · one location`
            : "Not filed under a client"
        }
        controls={
          <>
            <LocationSelect
              locations={siblings}
              value={locationId}
              onChange={(next) => {
                const params = new URLSearchParams(searchParams.toString())
                if (next) params.set("locationId", next)
                else {
                  params.delete("locationId")
                  if (location.clientId)
                    params.set("clientId", location.clientId)
                }
                router.replace(`${pathname}?${params.toString()}`, {
                  scroll: false,
                })
              }}
            />
            <Link
              href={`/listings/${location.id}`}
              className={cn(
                buttonVariants({ variant: "secondary" }),
                "flex-1 sm:flex-none"
              )}
            >
              Open listing
            </Link>
            <Link
              href={
                location.clientId
                  ? `/reports?clientId=${location.clientId}`
                  : "/reports"
              }
              className={cn(
                buttonVariants({ variant: "secondary" }),
                "flex-1 sm:flex-none"
              )}
            >
              {location.clientId ? "Whole client" : "All clients"}
            </Link>
          </>
        }
      />
      <LocationPerformance locationId={locationId} />
    </div>
  )
}

export { LocationReport }
