"use client"

import { History, RefreshCw } from "lucide-react"
import { useId } from "react"

import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Empty } from "@/components/ui/empty"
import { SectionHeader } from "@/components/ui/section-header"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill, type PillTone } from "@/components/ui/status-pill"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useBackfill } from "@/lib/queries/use-backfill"
import { describeActionError, isPausedError } from "@/lib/errors/action-errors"
import type { BackfillItem } from "@/lib/api/backfill"
import type { StatusTone } from "@/lib/ui/status-tone"

const STATUS: Record<
  string,
  { label: string; tone: StatusTone | PillTone; dashed?: boolean }
> = {
  not_started: { label: "Not started", tone: "neutral", dashed: true },
  pending: { label: "Queued", tone: "neutral", dashed: true },
  running: { label: "Syncing…", tone: "info" },
  succeeded: { label: "Synced", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
}

function statusPill(status: string) {
  const entry = STATUS[status] ?? { label: status, tone: "neutral" as const }
  return (
    <StatusPill tone={entry.tone} dashed={entry.dashed}>
      {entry.label}
    </StatusPill>
  )
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
 * Review history import (reference `backfill-section`), one row per
 * location: the honest status the sync checkpoint reports, how many times it
 * has tried, why it failed in plain words, and Cancel while it is still in
 * flight. The checkpoint reports no review counts, so there is no progress
 * bar: a percentage would be invented. Labelled rows under 720px.
 */
export function BackfillCard() {
  const { query, start, cancel } = useBackfill()
  const headingId = useId()

  const header = (
    <SectionHeader
      id={headingId}
      title="Backfill reviews"
      description="Past reviews pulled from Google, per location. Failed imports retry on their own."
      actions={
        query.data ? (
          <Button
            variant="secondary"
            size="sm"
            pending={start.isPending}
            pendingLabel="Starting…"
            onClick={() => start.mutate({ maxPagesPerLocation: 10 })}
          >
            Start sync
          </Button>
        ) : undefined
      }
    />
  )

  if (query.isPending) {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        {header}
        <Skeleton
          aria-busy="true"
          className="h-28 w-full rounded-(--np-radius-card)"
        />
      </section>
    )
  }
  if (query.isError) {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        {header}
        <Alert variant="destructive">
          <AlertTitle>We couldn’t load sync progress</AlertTitle>
          <AlertDescription>{describeActionError(query.error)}</AlertDescription>
          <AlertActions>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => query.refetch()}
            >
              <RefreshCw aria-hidden />
              Try again
            </Button>
          </AlertActions>
        </Alert>
      </section>
    )
  }

  const items = query.data.progress.items
  const paused = isPausedError(start.error)

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      {header}
      {paused ? (
        <Alert variant="warning">
          <AlertTitle>Review sync is paused</AlertTitle>
          <AlertDescription>
            Sync is temporarily paused. Try again shortly.
          </AlertDescription>
        </Alert>
      ) : null}
      {items.length === 0 ? (
        <Card flush>
          <Empty
            icon={<History />}
            title="No sync activity yet"
            description="Import a location, then start a sync to pull its review history."
          />
        </Card>
      ) : (
        <Table surface responsive aria-label="Sync progress by location">
          <TableHeader>
            <TableRow>
              <TableHead>Location</TableHead>
              <TableHead numeric>Attempts</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item: BackfillItem) => {
              const inFlight =
                item.status === "running" || item.status === "pending"
              const failure =
                item.status === "failed" && item.lastErrorCode
                  ? describeBackfillError(item.lastErrorCode)
                  : null
              return (
                <TableRow key={item.externalLocationId}>
                  <TableCell label="Location">
                    <span className="flex min-w-0 flex-col">
                      <span className="font-semibold [overflow-wrap:anywhere] text-ink">
                        {item.locationName ?? "Location"}
                      </span>
                      {failure || item.hasMorePages ? (
                        <span className="text-caption text-ink-muted">
                          {failure ? (
                            <span className="text-danger-ink">{failure}</span>
                          ) : null}
                          {failure && item.hasMorePages ? " · " : null}
                          {item.hasMorePages ? "More to sync" : null}
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell label="Attempts" numeric>
                    <span className="sr-only">{attempts(item.attemptCount)}</span>
                    <span aria-hidden>{item.attemptCount}</span>
                  </TableCell>
                  <TableCell label="Status">{statusPill(item.status)}</TableCell>
                  <TableCell data-actions="" className="text-right">
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
