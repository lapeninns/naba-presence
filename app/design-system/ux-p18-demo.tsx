"use client"

import {
  ScheduledJobsDisclosure,
  SchedulerSummaryAlert,
} from "@/components/settings/scheduled-jobs-panel"
import { schedulerTickSchema } from "@/lib/contracts/operations"
import { summariseScheduler } from "@/lib/operations/job-labels"

const NOW = new Date("2026-10-15T12:00:00Z")
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000).toISOString()

const tick = (
  name: string,
  minutes: number | null,
  staleAfterSeconds: number
) =>
  schedulerTickSchema.parse({
    name,
    lastCompletedAt: minutes === null ? null : minutesAgo(minutes),
    staleAfterSeconds,
    stale: false,
  })

const CASES = [
  {
    title: "Everything on schedule: success line, details closed",
    ticks: [tick("jobs", 1, 300), tick("reconcile", 9, 2_700)],
    heartbeatStale: false,
  },
  {
    title: "Some jobs overdue: warning line, details open",
    ticks: [
      tick("jobs", 1, 300),
      tick("reconcile", 100, 2_700),
      tick("presence-resources", 100, 2_700),
    ],
    heartbeatStale: false,
  },
  {
    title: "Nothing running: danger line, details open",
    ticks: [tick("jobs", 600, 300), tick("reconcile", null, 2_700)],
    heartbeatStale: true,
  },
] as const

/**
 * Operations summary: one `Alert` that says what the state means and what to
 * do, then the per-job detail in a disclosure of non-interactive `ListRow`s
 * (plain-English name, state pill, last run in the organisation's time zone,
 * the internal key under "Details for support").
 */
export function UxP18Demo() {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-ui font-semibold text-ink-muted">
        Operations summary and job details
      </h3>
      <div className="grid gap-6 lg:grid-cols-3">
        {CASES.map(({ title, ticks, heartbeatStale }) => {
          const summary = summariseScheduler(ticks, heartbeatStale, NOW)
          return (
            <div key={title} className="flex min-w-0 flex-col gap-3">
              <p className="text-caption text-ink-muted">{title}</p>
              <SchedulerSummaryAlert summary={summary} />
              <ScheduledJobsDisclosure
                ticks={[...ticks]}
                summary={summary}
                timeZone="Pacific/Auckland"
                now={NOW}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
