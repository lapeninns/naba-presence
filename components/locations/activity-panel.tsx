"use client"

import { useState } from "react"

import { LocationTab } from "@/components/locations/location-tab"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { LocationActivityState } from "@/lib/contracts/location-activity"
import { formatNumber } from "@/lib/format"
import { useLocationActivity } from "@/lib/queries/use-location-activity"

const PAGE_SIZE = 10

function humanise(value: string): string {
  const lower = value.toLowerCase().replace(/_/g, " ")
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function statusVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "succeeded") return "secondary"
  if (status === "failed" || status === "ambiguous") return "destructive"
  return "outline"
}

export function LocationActivityPanel({ locationId }: { locationId: string }) {
  const [page, setPage] = useState(1)
  // The page is part of the query key, so the resource hook closes over it.
  // It always calls the same hook, which is all the shell requires.
  function useActivityPage(id: string) {
    return useLocationActivity(id, { page, pageSize: PAGE_SIZE })
  }

  return (
    <LocationTab locationId={locationId} useResource={useActivityPage}>
      {({ data: activity }) => (
        <ActivityList activity={activity} page={page} onPageChange={setPage} />
      )}
    </LocationTab>
  )
}

function ActivityList({
  activity,
  page,
  onPageChange,
}: {
  activity: LocationActivityState
  page: number
  onPageChange: (next: number) => void
}) {
  const pageCount = Math.max(1, Math.ceil(activity.total / activity.pageSize))

  return (
    <section className="flex flex-col gap-3">
      {/* The drawer's own SheetTitle is the heading here; a second one would
          repeat it and break heading order inside the dialog. */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-caption text-muted-foreground">
          {formatNumber(activity.total)} recorded{" "}
          {activity.total === 1 ? "change" : "changes"}
        </p>
      </div>
      {activity.items.length === 0 ? (
        <p className="text-ui text-muted-foreground">
          No Google management changes recorded for this location yet.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {activity.items.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-1 rounded-(--np-radius-card) border border-border px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ui font-medium">
                    {humanise(item.operation)}
                  </span>
                  <Badge variant="outline">{humanise(item.resourceType)}</Badge>
                  <Badge variant={statusVariant(item.status)}>
                    {humanise(item.status)}
                  </Badge>
                </div>
                <p className="text-caption text-muted-foreground">
                  {new Date(item.createdAt).toLocaleString("en-GB")}
                  {item.actorDisplayName
                    ? ` · ${item.actorDisplayName}`
                    : null}
                  {item.updateMask.length > 0
                    ? ` · ${item.updateMask.map(humanise).join(", ")}`
                    : null}
                  {item.lastErrorCode
                    ? ` · ${humanise(item.lastErrorCode)}`
                    : null}
                </p>
              </li>
            ))}
          </ul>
          {pageCount > 1 ? (
            <nav
              aria-label="Activity pages"
              className="flex items-center justify-between gap-2"
            >
              <Button
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => onPageChange(Math.max(1, page - 1))}
              >
                Previous
              </Button>
              <span className="text-caption text-muted-foreground tabular-nums">
                Page {page} of {pageCount}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => onPageChange(Math.min(pageCount, page + 1))}
              >
                Next
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </section>
  )
}
