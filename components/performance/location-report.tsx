"use client"

import { MapPinIcon, SearchXIcon } from "lucide-react"
import Link from "next/link"

import { LocationPerformance } from "@/components/performance/location-performance"
import { buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"

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
        <Skeleton className="h-16 w-full rounded-(--np-radius-card)" />
        <Skeleton className="h-40 w-full rounded-(--np-radius-card)" />
      </div>
    )
  }

  if (!location) {
    return (
      <div className="rounded-(--np-radius-card) bg-surface">
        <Empty
          icon={<SearchXIcon />}
          title="This location isn’t in your directory"
          description="It may have been removed, or it belongs to a client you can’t see."
          action={
            <Link
              href="/reports"
              className={buttonVariants({ variant: "secondary", pill: true })}
            >
              All clients
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      <div
        data-slot="report-scope"
        className="flex flex-col gap-3 rounded-(--np-radius-card) bg-surface p-(--np-card-pad) sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-(--np-radius-pill) bg-fill text-ink-muted"
          >
            <MapPinIcon className="size-4" strokeWidth={1.75} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-ui font-medium text-ink">
              Reporting on {location.name}
            </p>
            <p className="truncate text-caption text-ink-muted">
              {location.clientName
                ? `${location.clientName} · one location`
                : "Not filed under a client"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            href={`/locations/${location.id}`}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            Open listing
          </Link>
          <Link
            href={
              location.clientId
                ? `/reports?clientId=${location.clientId}`
                : "/reports"
            }
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            {location.clientId ? "Whole client" : "All clients"}
          </Link>
        </div>
      </div>
      <LocationPerformance locationId={locationId} />
    </div>
  )
}

export { LocationReport }
