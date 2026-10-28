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
  running: { label: "Importing…", tone: "info" },
  succeeded: { label: "Imported", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  // Terminal (lib/contracts/sync.ts): the runner stopped retrying it.
  dead: { label: "Stopped", tone: "bad" },
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
    "This Google login needs reconnecting. Reconnect it to continue.",
  sync_failed: "Google did not respond. It will retry automatically.",
  job_failed: "The import failed unexpectedly. It will retry automatically.",
}

function describeBackfillError(code: string): string {
  return (
    BACKFILL_ERROR_COPY[code] ??
    "This import could not complete. It will retry automatically."
  )
}

// A stopped (dead) import is never retried by the runner; only starting the
// import again (the header's button) re-arms it. The row names the button by
// place, not label: it reads Start while another listing is still queued (the checkpoint upsert
// in syncLinkedLocation).
function describeStoppedImport(code: string | null): string {
  if (code === "location_not_verified")
    return "This location is not yet verified on Google. Import again with the button above once it is."
  return "The import stopped after repeated failures. Import again with the button above to try again."
}

const IN_FLIGHT = new Set(["running", "pending"])
// Rows that ended without importing: starting again is then a retry.
const UNSUCCESSFUL = new Set(["failed", "dead", "cancelled"])

function attempts(count: number): string {
  return count === 1 ? "1 attempt" : `${count} attempts`
}

/**
 * Review history import (reference `backfill-section`), one row per
 * location: the honest status the sync checkpoint reports, how many times it
 * has tried, why it failed in plain words, and Cancel while it is still
 * queued (the server refuses to cancel a batch that is already running).
 * The checkpoint reports no review counts, so there is no progress bar: a
 * percentage would be invented. Record cards below 48rem of the table's width.
 *
 * `externalLocationIds` scopes the card to one client's linked listings: only
 * their rows show and Start imports only them. Without it the card covers
 * every linked listing in the organisation.
 *
 * While nothing is importing or imported, Start is the primary action (setup
 * cannot continue without it) and carries `id="setup-backfill-start"` so a
 * blocked Continue can send focus to it. It reads "Retry import" when
 * nothing is in flight and a listing failed, stopped or was cancelled.
 */
export function BackfillCard({
  externalLocationIds,
  onStartSettled,
  inFlightNote,
}: {
  externalLocationIds?: readonly string[]
  /**
   * Called once Start has its server answer, success or not, so a caller
   * whose own state depends on the import (setup's Continue) can re-read it.
   */
  onStartSettled?: () => void
  /** Shown under the rows only while a listing is queued or importing. */
  inFlightNote?: React.ReactNode
} = {}) {
  const { query, start, cancel } = useBackfill()
  const headingId = useId()
  const scoped = externalLocationIds !== undefined
  const nothingInScope = scoped && externalLocationIds.length === 0

  const inScope = scoped ? new Set(externalLocationIds) : null
  const items = (query.data?.progress.items ?? []).filter(
    (item) => !inScope || inScope.has(item.externalLocationId)
  )
  const inFlight = items.some((item) => IN_FLIGHT.has(item.status))
  const needsStart =
    !inFlight && !items.some((item) => item.status === "succeeded")
  const retry = !inFlight && items.some((item) => UNSUCCESSFUL.has(item.status))

  const header = (
    <SectionHeader
      id={headingId}
      title="Import reviews"
      description="Past reviews from Google, per listing. Some failures retry on their own; the reason shows on the listing."
      actions={
        query.data && !nothingInScope ? (
          <Button
            id="setup-backfill-start"
            variant={needsStart ? "default" : "secondary"}
            size={needsStart ? "default" : "sm"}
            pending={start.isPending}
            pendingLabel="Starting…"
            onClick={() =>
              start.mutate(
                scoped
                  ? {
                      externalLocationIds: [...externalLocationIds],
                      maxPagesPerLocation: 10,
                    }
                  : { maxPagesPerLocation: 10 },
                { onSettled: onStartSettled }
              )
            }
          >
            {retry ? "Retry import" : "Start import"}
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
          <AlertTitle>We couldn’t load import progress</AlertTitle>
          <AlertDescription>
            {describeActionError(query.error)}
          </AlertDescription>
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

  const paused = isPausedError(start.error)
  const startFailed = start.error && !paused ? start.error : null

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      {header}
      {paused ? (
        <Alert variant="warning">
          <AlertTitle>Review import is paused</AlertTitle>
          <AlertDescription>
            Importing is paused on our side. Try again later.
          </AlertDescription>
        </Alert>
      ) : null}
      {startFailed ? (
        <Alert variant="destructive">
          <AlertTitle>The import didn’t start</AlertTitle>
          <AlertDescription>
            {describeActionError(startFailed)}
          </AlertDescription>
        </Alert>
      ) : null}
      {cancel.error ? (
        <Alert variant="destructive">
          <AlertTitle>We couldn’t cancel the import</AlertTitle>
          <AlertDescription>
            {describeActionError(cancel.error)}
          </AlertDescription>
        </Alert>
      ) : null}
      {items.length === 0 ? (
        <Card flush>
          <Empty
            icon={<History />}
            title={nothingInScope ? "No linked listings yet" : "No imports yet"}
            description={
              nothingInScope
                ? "Link a listing first, then import its review history."
                : "Start an import to pull each listing’s review history."
            }
          />
        </Card>
      ) : (
        <Table surface responsive aria-label="Import progress by listing">
          <TableHeader>
            <TableRow>
              <TableHead>Listing</TableHead>
              <TableHead numeric>Attempts</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item: BackfillItem) => {
              const failure =
                item.status === "failed" && item.lastErrorCode
                  ? describeBackfillError(item.lastErrorCode)
                  : item.status === "dead"
                    ? describeStoppedImport(item.lastErrorCode)
                    : null
              return (
                <TableRow key={item.externalLocationId}>
                  <TableCell label="Listing">
                    <span className="flex min-w-0 flex-col">
                      <span className="font-semibold [overflow-wrap:anywhere] text-ink">
                        {item.locationName ?? "Listing"}
                      </span>
                      {failure || item.hasMorePages ? (
                        <span className="text-caption text-ink-muted">
                          {failure ? (
                            <span className="text-danger-ink">{failure}</span>
                          ) : null}
                          {failure && item.hasMorePages ? " · " : null}
                          {item.hasMorePages ? "More to import" : null}
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                  {/* No attempt yet: nothing to count, so no "0" and no
                      record-card label, only words for a screen reader. */}
                  <TableCell
                    label={item.attemptCount > 0 ? "Attempts" : undefined}
                    numeric
                  >
                    {item.attemptCount > 0 ? (
                      <>
                        <span className="sr-only">
                          {attempts(item.attemptCount)}
                        </span>
                        <span aria-hidden>{item.attemptCount}</span>
                      </>
                    ) : (
                      <span className="sr-only">No attempts yet</span>
                    )}
                  </TableCell>
                  <TableCell label="Status">
                    {statusPill(item.status)}
                  </TableCell>
                  <TableCell actions className="text-right">
                    {/* Only a queued row: the server refuses to cancel a
                        batch that is already running. */}
                    {item.status === "pending" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={cancel.isPending}
                        aria-label={`Cancel import for ${item.locationName ?? "listing"}`}
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
      {inFlight && inFlightNote ? inFlightNote : null}
    </section>
  )
}
