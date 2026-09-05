"use client"

import { History } from "lucide-react"
import { useId } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { GroupedList, GroupedListItem } from "@/components/ui/grouped-list"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { useBackfill } from "@/lib/queries/use-backfill"
import { describeActionError, isPausedError } from "@/lib/errors/action-errors"
import type { BackfillItem } from "@/lib/api/backfill"
import type { StatusTone } from "@/lib/ui/status-tone"

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  not_started: { label: "Not started", tone: "neutral" },
  pending: { label: "Queued", tone: "pending" },
  running: { label: "Syncing…", tone: "pending" },
  succeeded: { label: "Synced", tone: "healthy" },
  failed: { label: "Failed", tone: "attention" },
  cancelled: { label: "Cancelled", tone: "neutral" },
}

function statusPill(status: string) {
  const entry = STATUS[status] ?? { label: status, tone: "neutral" as const }
  return <StatusPill tone={entry.tone}>{entry.label}</StatusPill>
}

// Humanises a sync_checkpoint.last_error_code for a failed backfill row. Never
// renders the raw code — unrecognised codes fall back to a generic, honest
// message rather than leaking the enum.
const BACKFILL_ERROR_COPY: Record<string, string> = {
  location_not_verified: "This location is not yet verified on Google.",
  location_not_linked: "This location is no longer linked to Google.",
  google_reconnect_required:
    "Google access has expired. Reconnect this account to continue.",
  sync_failed: "Google did not respond. It will retry automatically.",
  job_failed: "The sync job failed unexpectedly. It will retry automatically.",
}

function describeBackfillError(code: string): string {
  return (
    BACKFILL_ERROR_COPY[code] ??
    "This sync could not complete. It will retry automatically."
  )
}

function attempts(count: number): string {
  return count === 1 ? "1 attempt" : `${count} attempts`
}

/**
 * Review history import, one row per location: the honest status the sync
 * checkpoint reports, how many times it has tried, and Cancel while it is
 * still in flight.
 */
export function BackfillCard() {
  const { query, start, cancel } = useBackfill()
  const headingId = useId()

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-[calc(var(--np-row-h)*2)] w-full rounded-(--np-radius-card)" />
      </div>
    )
  }
  if (query.isError) {
    return (
      <Empty
        title="We couldn’t load sync progress"
        description={describeActionError(query.error)}
        action={
          <Button variant="outline" onClick={() => query.refetch()}>
            Try again
          </Button>
        }
      />
    )
  }

  const items = query.data.progress.items
  const paused = isPausedError(start.error)

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-title font-semibold text-ink">
          Backfill reviews
        </h2>
        <Button
          disabled={start.isPending}
          onClick={() => start.mutate({ maxPagesPerLocation: 10 })}
        >
          {start.isPending ? "Starting…" : "Start sync"}
        </Button>
      </div>
      {paused ? (
        <Alert variant="warning">
          <AlertTitle>Review sync is paused</AlertTitle>
          <AlertDescription>
            Sync is temporarily paused. Try again shortly.
          </AlertDescription>
        </Alert>
      ) : null}
      {items.length === 0 ? (
        <Empty
          icon={<History />}
          title="No sync activity yet"
          description="Import a location, then start a sync to pull its review history."
        />
      ) : (
        <GroupedList aria-label="Sync progress by location">
          {items.map((item: BackfillItem) => {
            const inFlight =
              item.status === "running" || item.status === "pending"
            const failure =
              item.status === "failed" && item.lastErrorCode
                ? describeBackfillError(item.lastErrorCode)
                : null
            return (
              <GroupedListItem
                key={item.externalLocationId}
                label={item.locationName ?? "Location"}
                description={
                  failure || item.hasMorePages ? (
                    <>
                      {failure ? (
                        <span className="text-danger-ink">{failure}</span>
                      ) : null}
                      {failure && item.hasMorePages ? " · " : null}
                      {item.hasMorePages ? "More to sync" : null}
                    </>
                  ) : undefined
                }
                trailing={
                  <>
                    <span className="text-caption">
                      {attempts(item.attemptCount)}
                    </span>
                    {statusPill(item.status)}
                    {inFlight ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={cancel.isPending}
                        aria-label={`Cancel sync for ${item.locationName ?? "location"}`}
                        onClick={() => cancel.mutate([item.externalLocationId])}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </>
                }
              />
            )
          })}
        </GroupedList>
      )}
    </section>
  )
}
