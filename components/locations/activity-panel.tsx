"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TabError, TabLoading } from "@/components/locations/tab-states"
import { useLocationActivity } from "@/lib/queries/use-location-activity"
import { formatNumber } from "@/lib/format"
import { useState } from "react"

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
  const query = useLocationActivity(locationId, { page, pageSize: 10 })

  if (query.isPending) return <TabLoading />
  if (query.isError) {
    return (
      <TabError error={query.error} onRetry={() => void query.refetch()} />
    )
  }

  const activity = query.data
  const pageCount = Math.max(1, Math.ceil(activity.total / activity.pageSize))

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-title font-semibold">Recent activity</h2>
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
                className="flex flex-col gap-1 rounded-(--nr-radius-card) border border-border px-3 py-2"
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
                onClick={() => setPage((current) => Math.max(1, current - 1))}
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
                onClick={() =>
                  setPage((current) => Math.min(pageCount, current + 1))
                }
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
