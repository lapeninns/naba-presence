"use client"

import { QueryStates, queryStatus } from "@/components/ui/query-states"
import { StatusPill } from "@/components/ui/status-pill"
import type { RetentionCycleSummary } from "@/lib/api/privacy"
import { formatDateTime, formatNumber } from "@/lib/format"
import { useRetentionStatus } from "@/lib/queries/use-privacy"
import { retentionOrganisationLabel } from "@/lib/settings/privacy"

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line pb-1.5">
      <dt className="text-ui text-ink-secondary">{label}</dt>
      <dd className="text-ui text-ink">{children}</dd>
    </div>
  )
}

function CycleStanding({ cycle }: { cycle: RetentionCycleSummary }) {
  const standing = retentionOrganisationLabel(cycle.organisation)
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <StatusPill tone={standing.tone}>{standing.label}</StatusPill>
      <span className="text-caption text-ink-muted">
        {cycle.completedAt
          ? `Cycle of ${cycle.cycleDate}, finished ${formatDateTime(cycle.completedAt, "UTC")} UTC`
          : `Cycle of ${cycle.cycleDate}, started ${formatDateTime(cycle.startedAt, "UTC")} UTC`}
      </span>
    </span>
  )
}

/**
 * Retention status (plan P04-7): how this organisation fared in the last
 * completed daily retention cycle and the one running now, how long raw
 * review content is kept, and what legal holds keep back. Read-only; owners
 * and admins both see it.
 */
export function RetentionStatusCard() {
  const query = useRetentionStatus()
  return (
    <section
      aria-labelledby="retention-status"
      className="flex flex-col gap-3 rounded-(--np-radius-card) border border-line bg-surface p-(--np-card-pad)"
    >
      <div>
        <h2 id="retention-status" className="text-title font-semibold text-ink">
          Retention
        </h2>
        <p className="text-caption text-ink-muted">
          Google review content is redacted, and expired records deleted, by a
          daily run from 03:00 UTC.
        </p>
      </div>
      <QueryStates
        status={queryStatus(query)}
        pendingLabel="Loading retention status"
        error={{
          title: "We couldn’t load retention status",
          cause: query.error,
        }}
        onRetry={() => void query.refetch()}
      >
        {() => {
          const status = query.data!
          return (
            <dl className="flex flex-col gap-2">
              <Row label="Last completed run">
                {status.lastCompletedCycle ? (
                  <CycleStanding cycle={status.lastCompletedCycle} />
                ) : (
                  <span className="text-ink-muted">None yet</span>
                )}
              </Row>
              {status.currentCycle ? (
                <Row label="Run in progress">
                  <CycleStanding cycle={status.currentCycle} />
                </Row>
              ) : null}
              <Row label="Raw review content kept for">
                {status.rawContentRetentionDays}{" "}
                {status.rawContentRetentionDays === 1 ? "day" : "days"}
              </Row>
              <Row label="Deletion">
                {status.deletesEnabled ? (
                  <StatusPill tone="healthy">On</StatusPill>
                ) : (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <StatusPill tone="attention">Paused</StatusPill>
                    <span className="text-caption text-ink-muted">
                      Redaction still runs; expired records are kept until
                      deletion resumes.
                    </span>
                  </span>
                )}
              </Row>
              <Row label="Reviews under legal hold">
                {formatNumber(status.heldReviews)}
              </Row>
              <Row label="Disconnected locations kept by a hold">
                {formatNumber(status.heldLocations)}
              </Row>
            </dl>
          )
        }}
      </QueryStates>
    </section>
  )
}
