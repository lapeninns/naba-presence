"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useBackfill } from "@/lib/queries/use-backfill"
import { describeActionError, isPausedError } from "@/lib/settings/action-errors"
import type { BackfillItem } from "@/lib/api/backfill"

const STATUS: Record<string, { label: string; variant: "secondary" | "info" | "success" | "warning" | "outline" }> = {
  not_started: { label: "Not started", variant: "outline" },
  pending: { label: "Queued", variant: "info" },
  running: { label: "Syncing…", variant: "info" },
  succeeded: { label: "Synced", variant: "success" },
  failed: { label: "Failed", variant: "warning" },
  cancelled: { label: "Cancelled", variant: "secondary" },
}

function statusBadge(status: string) {
  const entry = STATUS[status] ?? { label: status, variant: "secondary" as const }
  return <Badge variant={entry.variant}>{entry.label}</Badge>
}

// Humanises a sync_checkpoint.last_error_code for a failed backfill row. Never
// renders the raw code — unrecognised codes fall back to a generic, honest
// message rather than leaking the enum.
const BACKFILL_ERROR_COPY: Record<string, string> = {
  location_not_verified: "This location is not yet verified on Google.",
  location_not_linked: "This location is no longer linked to Google.",
  google_reconnect_required: "Google access has expired. Reconnect this account to continue.",
  sync_failed: "Google did not respond. It will retry automatically.",
  job_failed: "The sync job failed unexpectedly. It will retry automatically.",
}

function describeBackfillError(code: string): string {
  return BACKFILL_ERROR_COPY[code] ?? "This sync could not complete. It will retry automatically."
}

export function BackfillCard() {
  const { query, start, cancel } = useBackfill()

  if (query.isPending) {
    return <Skeleton className="h-32 w-full" />
  }
  if (query.isError) {
    return (
      <Empty
        title="We couldn’t load sync progress"
        description={describeActionError(query.error)}
        action={<Button variant="outline" onClick={() => query.refetch()}>Try again</Button>}
      />
    )
  }

  const items = query.data.progress.items
  const paused = isPausedError(start.error)

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title">Backfill reviews</h2>
      {paused ? (
        <Alert variant="warning">
          <AlertTitle>Review sync is paused</AlertTitle>
          <AlertDescription>Sync is temporarily paused. Try again shortly.</AlertDescription>
        </Alert>
      ) : null}
      <div>
        <Button disabled={start.isPending} onClick={() => start.mutate({ maxPagesPerLocation: 10 })}>
          {start.isPending ? "Starting…" : "Start sync"}
        </Button>
      </div>
      {items.length === 0 ? (
        <Empty title="No sync activity yet" description="Import a location, then start a sync to pull its review history." />
      ) : (
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item: BackfillItem) => {
              const inFlight = item.status === "running" || item.status === "pending"
              return (
                <TableRow key={item.externalLocationId}>
                  <TableCell className="font-medium">{item.locationName ?? "Location"}</TableCell>
                  <TableCell>
                    <span className="flex flex-col gap-1">
                      <span className="flex items-center gap-2">
                        {statusBadge(item.status)}
                        {item.hasMorePages ? <span className="text-caption text-muted-foreground">More to sync</span> : null}
                      </span>
                      {item.status === "failed" && item.lastErrorCode ? (
                        <span className="text-caption text-destructive">{describeBackfillError(item.lastErrorCode)}</span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{item.attemptCount}</TableCell>
                  <TableCell>
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
                    ) : (
                      <span className="text-caption text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
