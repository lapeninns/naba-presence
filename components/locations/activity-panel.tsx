"use client"

import { useState } from "react"

import { LocationTab } from "@/components/locations/location-tab"
import { Button } from "@/components/ui/button"
import { StatusPill } from "@/components/ui/status-pill"
import { Timeline, type TimelineTone } from "@/components/ui/timeline"
import type { LocationActivityState } from "@/lib/contracts/location-activity"
import { formatNumber } from "@/lib/format"
import { useLocationActivity } from "@/lib/queries/use-location-activity"

const PAGE_SIZE = 10

function humanise(value: string): string {
  const lower = value.toLowerCase().replace(/_/g, " ")
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function statusTone(status: string): TimelineTone {
  if (status === "succeeded") return "success"
  if (status === "failed" || status === "ambiguous") return "danger"
  return "neutral"
}

function statusPillTone(status: string): "ok" | "bad" | "outline" {
  if (status === "succeeded") return "ok"
  if (status === "failed" || status === "ambiguous") return "bad"
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

/**
 * A plain list of hairline-divided rows. It sits on the sheet's white, so
 * the rows need no card of their own; the separators do the work.
 */
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
      <p className="text-caption text-ink-muted tabular-nums">
        {formatNumber(activity.total)} recorded{" "}
        {activity.total === 1 ? "change" : "changes"}
      </p>
      {activity.items.length === 0 ? (
        <p className="text-ui text-ink-muted">
          No Google management changes recorded for this location yet.
        </p>
      ) : (
        <>
          <Timeline
            aria-label="Recent changes"
            entries={activity.items.map((item) => ({
              id: item.id,
              tone: statusTone(item.status),
              title: (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold text-ink">
                    {humanise(item.operation)} · {humanise(item.resourceType)}
                  </span>
                  <StatusPill tone={statusPillTone(item.status)}>
                    {humanise(item.status)}
                  </StatusPill>
                </span>
              ),
              meta: [
                item.actorDisplayName,
                item.updateMask.length > 0
                  ? item.updateMask.map(humanise).join(", ")
                  : null,
                item.lastErrorCode ? humanise(item.lastErrorCode) : null,
              ]
                .filter(Boolean)
                .join(" · "),
              when: new Date(item.createdAt).toLocaleString("en-GB", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }),
            }))}
          />
          {pageCount > 1 ? (
            <nav
              aria-label="Activity pages"
              className="flex items-center justify-between gap-2"
            >
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => onPageChange(Math.max(1, page - 1))}
              >
                Previous
              </Button>
              <span className="text-caption text-ink-muted tabular-nums">
                Page {page} of {pageCount}
              </span>
              <Button
                variant="secondary"
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
