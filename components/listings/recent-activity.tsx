"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { Timeline, type TimelineEntry } from "@/components/ui/timeline"
import type { LocationActivityItem } from "@/lib/contracts/location-activity"
import { formatRelativeTime } from "@/lib/format"
import { useLocationActivity } from "@/lib/queries/use-location-activity"

function humanise(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").trim()
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : value
}

function toneFor(status: string): TimelineEntry["tone"] {
  switch (status) {
    case "succeeded":
      return "success"
    case "failed":
      return "danger"
    case "ambiguous":
      return "warning"
    default:
      return "neutral"
  }
}

function title(item: LocationActivityItem): string {
  const what = `${humanise(item.operation)} · ${humanise(item.resourceType)}`
  switch (item.status) {
    case "succeeded":
      return `${what} published`
    case "failed":
      return `${what} failed`
    case "ambiguous":
      return `${what} — outcome unclear`
    default:
      return `${what} in progress`
  }
}

/**
 * The last few things that went to Google from here, newest first. The
 * drawer in the header holds the full, paginated history; this is the glance.
 */
function RecentActivity({
  locationId,
  limit = 5,
}: {
  locationId: string
  limit?: number
}) {
  const activity = useLocationActivity(locationId, { page: 1, pageSize: limit })

  if (activity.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-9 w-full max-w-md" />
        ))}
      </div>
    )
  }
  if (activity.isError) {
    return (
      <p className="text-ui text-ink-muted" role="status">
        We couldn’t load recent activity. The drawer under Activity retries when
        you open it.
      </p>
    )
  }
  const items = activity.data.items
  if (items.length === 0) {
    return (
      <p className="text-ui text-ink-muted">
        Nothing has been published from here yet.
      </p>
    )
  }
  return (
    <Timeline
      entries={items.map((item) => ({
        id: item.id,
        title: title(item),
        when: formatRelativeTime(item.finishedAt ?? item.createdAt),
        detail: (
          <>
            {item.actorDisplayName ?? "Someone"}
            {item.lastErrorCode ? (
              <>
                {" · "}
                <code className="inline-block max-w-full rounded-(--np-radius-tag) border border-line bg-surface-alt px-1 font-mono text-[11.5px] break-all text-ink-secondary">
                  {item.lastErrorCode}
                </code>
              </>
            ) : null}
          </>
        ),
        tone: toneFor(item.status),
      }))}
    />
  )
}

export { RecentActivity }
