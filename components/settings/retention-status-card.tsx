"use client"

import Link from "next/link"

import {
  SettingsFacts,
  SettingsSection,
} from "@/components/settings/settings-section"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import { StatusPill } from "@/components/ui/status-pill"
import type { RetentionCycleSummary } from "@/lib/api/privacy"
import { formatDateTime, formatNumber } from "@/lib/format"
import { useRetentionStatus } from "@/lib/queries/use-privacy"
import { retentionOrganisationLabel } from "@/lib/settings/privacy"

function CycleStanding({ cycle }: { cycle: RetentionCycleSummary }) {
  const standing = retentionOrganisationLabel(cycle.organisation)
  return (
    <span className="inline-flex flex-col items-start gap-1 sm:items-end">
      <StatusPill tone={standing.tone}>{standing.label}</StatusPill>
      <span className="text-caption text-ink-muted">
        {cycle.completedAt
          ? `Finished ${formatDateTime(cycle.completedAt, "UTC")} UTC`
          : `Started ${formatDateTime(cycle.startedAt, "UTC")} UTC`}
        {standing.code ? ` · code ${standing.code}` : null}
      </span>
    </span>
  )
}

/**
 * Retention status (plan P04-7): how this organisation fared in the last
 * completed daily retention cycle and the one running now, how long review
 * text is kept (named as Reply policy names it, with a link there to change
 * it), and what legal holds keep back. Read-only; owners
 * and admins both see it.
 */
export function RetentionStatusCard() {
  const query = useRetentionStatus()
  return (
    <SettingsSection
      variant="group"
      id="retention-status"
      title="Retention"
      description="Every day from 03:00 UTC, review text past its keep period is removed here and expired records are deleted. Reviews under a legal hold are skipped."
    >
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
            <SettingsFacts
              facts={[
                [
                  "Last completed run",
                  status.lastCompletedCycle ? (
                    <CycleStanding cycle={status.lastCompletedCycle} />
                  ) : (
                    <span className="text-ink-muted">None yet</span>
                  ),
                ],
                status.currentCycle
                  ? [
                      "Run in progress",
                      <CycleStanding
                        key="current"
                        cycle={status.currentCycle}
                      />,
                    ]
                  : null,
                [
                  "Review text kept for",
                  <span
                    key="kept"
                    className="inline-flex flex-col items-start gap-1 sm:items-end"
                  >
                    <span>
                      {status.rawContentRetentionDays}{" "}
                      {status.rawContentRetentionDays === 1 ? "day" : "days"}
                    </span>
                    <span className="text-caption text-ink-muted">
                      Then it’s removed here; it stays on Google. Change it in{" "}
                      <Link
                        href="/settings/policy#settings-retention"
                        className="text-accent-ink underline underline-offset-2"
                      >
                        Reply policy
                      </Link>
                      .
                    </span>
                  </span>,
                ],
                [
                  "Deletion",
                  status.deletesEnabled ? (
                    <StatusPill tone="healthy">On</StatusPill>
                  ) : (
                    <span className="inline-flex flex-col items-start gap-1 sm:items-end">
                      <StatusPill tone="attention">Paused</StatusPill>
                      <span className="text-caption text-ink-muted">
                        Redaction still runs; expired records are kept until
                        deletion resumes.
                      </span>
                    </span>
                  ),
                ],
                ["Reviews under legal hold", formatNumber(status.heldReviews)],
                [
                  "Disconnected locations kept by a hold",
                  formatNumber(status.heldLocations),
                ],
              ]}
            />
          )
        }}
      </QueryStates>
    </SettingsSection>
  )
}
