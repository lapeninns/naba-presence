"use client"

import { MapPinIcon } from "lucide-react"
import Link from "next/link"

import { LocationPerformance } from "@/components/performance/location-performance"
import {
  NotInDirectory,
  ReportScope,
} from "@/components/performance/report-scope"
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
 * workspace and the client hub through `?locationId=`, under a scope bar that
 * names the location and offers the way back to every client.
 */
function LocationReport({ locationId }: { locationId: string }) {
  const directory = useLocationDirectory(useSessionRole())
  const location = directory.data?.find((entry) => entry.id === locationId)

  if (directory.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-(--np-gap-section)">
        <Skeleton className="h-17 w-full rounded-(--np-radius-card)" />
        <Skeleton className="h-40 w-full rounded-(--np-radius-card)" />
      </div>
    )
  }

  if (!location) return <NotInDirectory kind="location" />

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
