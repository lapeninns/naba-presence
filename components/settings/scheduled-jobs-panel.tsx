"use client"

import { ChevronRight } from "lucide-react"
import { useState } from "react"

import { SupportDetails } from "@/components/editors/support-details"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ListRow, ListRows } from "@/components/ui/list-row"
import { RelativeTime } from "@/components/ui/relative-time"
import { StatusPill } from "@/components/ui/status-pill"
import type { SchedulerTick } from "@/lib/contracts/operations"
import {
  describeSchedule,
  isTickStale,
  scheduledJobInfo,
  type SchedulerSummary,
} from "@/lib/operations/job-labels"
import { formatZonedTime, usableZone } from "@/lib/operations/zoned-time"

const ALERT_VARIANT = {
  ok: "success",
  "some-stale": "warning",
  failing: "destructive",
} as const

/**
 * The page's one-line answer: what the scheduler's state means and what to
 * do about it. Polite even when it fails: it is page content on load, not
 * the result of a press.
 */
export function SchedulerSummaryAlert({
  summary,
}: {
  summary: SchedulerSummary
}) {
  return (
    <Alert
      variant={ALERT_VARIANT[summary.state]}
      live="polite"
      data-state={summary.state}
    >
      <AlertDescription>{summary.message}</AlertDescription>
    </Alert>
  )
}

/**
 * The per-job detail behind the summary, one `ListRow` per scheduled job:
 * a plain-English name and purpose, whether it is overdue, when it last
 * completed (relative, and the clock time in the organisation's time zone)
 * and the schedule it is judged against. The internal key is secondary,
 * under "Details for support". Collapsed while everything is on schedule;
 * open when something is overdue, and the person's own choice wins once made.
 */
export function ScheduledJobsDisclosure({
  ticks,
  summary,
  timeZone,
  now,
}: {
  ticks: SchedulerTick[]
  summary: SchedulerSummary
  /** The organisation's default time zone; null until it is known. */
  timeZone: string | null
  now: Date
}) {
  const [chosen, setChosen] = useState<boolean | null>(null)
  const open = chosen ?? summary.state !== "ok"
  const zone = usableZone(timeZone)
  return (
    <details
      data-slot="scheduled-jobs"
      className="group/jobs rounded-(--np-radius-control) border border-line"
      open={open}
      onToggle={(event) => setChosen(event.currentTarget.open)}
    >
      <summary className="flex min-h-(--np-touch) cursor-pointer list-none items-center gap-1.5 px-3 text-ui font-semibold text-ink focus-halo focus-visible:outline-none desk:min-h-9 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          strokeWidth={1.75}
          className="size-4 text-ink-muted transition-transform duration-(--np-duration-fast) group-open/jobs:rotate-90 motion-reduce:transition-none"
        />
        Details for each job
        <span className="font-normal text-ink-muted">
          ({ticks.length}
          {summary.overdue > 0 ? `, ${summary.overdue} overdue` : ""})
        </span>
      </summary>
      <ListRows aria-label="Scheduled jobs" className="px-3">
        {ticks.map((tick) => {
          const info = scheduledJobInfo(tick.name)
          const overdue = isTickStale(tick, now)
          return (
            <ListRow
              key={tick.name}
              interactive={false}
              flush
              wrap
              emphasis="neutral"
              wrapperProps={{ "data-job": tick.name }}
              title={info.label}
              subtitle={info.purpose}
              trailing={
                <StatusPill tone={overdue ? "bad" : "ok"}>
                  {overdue ? "Overdue" : "On schedule"}
                </StatusPill>
              }
              footerLayout="stack"
              footer={
                <>
                  <p className="text-caption text-ink-muted">
                    {tick.lastCompletedAt ? (
                      <>
                        <RelativeTime
                          iso={tick.lastCompletedAt}
                          prefix="Last run "
                          timeZone={zone}
                        />
                        {zone
                          ? ` · ${formatZonedTime(tick.lastCompletedAt, zone, now)}`
                          : null}
                      </>
                    ) : (
                      "Never completed"
                    )}
                  </p>
                  <p className="text-caption text-ink-muted">
                    {describeSchedule(info, tick.staleAfterSeconds)}
                  </p>
                  <SupportDetails items={[tick.name]} />
                </>
              }
            />
          )
        })}
      </ListRows>
    </details>
  )
}
