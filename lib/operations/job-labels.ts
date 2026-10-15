/**
 * Readable names for the scheduler ticks the Operations page lists.
 *
 * The keys are the tick names `lib/server/leases.ts` derives from its lease
 * keys (`naba:<name>`), which are also the `ops_heartbeat` row names the
 * health route reports. `intervalSeconds` is how often the tick is scheduled:
 * the cron schedule in `vercel.json`, matching the defaults in
 * `scripts/scheduler.mjs`. Change them together.
 *
 * How long a tick may go without a run before it counts as stale is not
 * decided here: the server sends `staleAfterSeconds` per tick
 * (`lib/server/ops-liveness.ts`), which is what alerting uses too.
 */
export type ScheduledJobInfo = {
  label: string
  purpose: string
  /**
   * What a stalled job may delay, as a noun phrase that completes "This may
   * delay ..." in the summary sentence ("review updates"). Null when the key
   * is unknown: the summary then says nothing specific rather than guess.
   */
  affects: string | null
  /** Scheduled interval in seconds; null when the key is unknown. */
  intervalSeconds: number | null
}

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const SCHEDULED_JOBS: Record<string, ScheduledJobInfo> = {
  jobs: {
    label: "Work queue",
    purpose: "Works through queued syncs, review events and reply publishing.",
    affects: "queued syncs and reply publishing",
    intervalSeconds: MINUTE,
  },
  reconcile: {
    label: "Review check",
    purpose:
      "Queues a check of every linked location for new or changed reviews.",
    affects: "review updates",
    intervalSeconds: 15 * MINUTE,
  },
  "presence-resources": {
    label: "Listing sync",
    purpose:
      "Reads hours, profile, posts, photos, menus and action links from Google.",
    affects: "listing updates from Google",
    intervalSeconds: 15 * MINUTE,
  },
  performance: {
    label: "Performance metrics",
    purpose: "Queues a refresh of Google search and Maps performance figures.",
    affects: "performance figures",
    intervalSeconds: 6 * HOUR,
  },
  sweep: {
    label: "Full review sweep",
    purpose:
      "Queues a full pass over each location's reviews to catch deletions and gaps.",
    affects: "the check for deleted reviews",
    intervalSeconds: DAY,
  },
  keywords: {
    label: "Search keywords",
    purpose:
      "Queues a refresh of the search terms that led people to listings.",
    affects: "search keyword figures",
    intervalSeconds: DAY,
  },
  retention: {
    label: "Data retention clean-up",
    purpose:
      "Works through each day's clean-up: redacts expired Google content and deletes records past their retention period.",
    affects: "data clean-up",
    intervalSeconds: 5 * MINUTE,
  },
  health: {
    label: "Health checks",
    purpose: "Checks for incidents and sends due notifications.",
    affects: "health notifications",
    intervalSeconds: 15 * MINUTE,
  },
  "billing-reconcile": {
    label: "Billing check",
    purpose:
      "Brings each organisation's subscription in line with Stripe, in case a billing event was missed.",
    affects: "billing status updates",
    intervalSeconds: HOUR,
  },
}

/** "presence-resources" -> "Presence resources". */
export function humaniseJobKey(key: string): string {
  const words = key.replace(/[-_:.]+/g, " ").trim()
  if (!words) return "Unnamed job"
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function scheduledJobInfo(key: string): ScheduledJobInfo {
  return (
    SCHEDULED_JOBS[key] ?? {
      label: humaniseJobKey(key),
      purpose: "Scheduled background task.",
      affects: null,
      intervalSeconds: null,
    }
  )
}

/** 60 -> "1 minute", 2700 -> "45 minutes", 64800 -> "18 hours". */
export function formatSpan(seconds: number): string {
  const unit = (value: number, name: string) =>
    `${value} ${name}${value === 1 ? "" : "s"}`
  if (seconds % DAY === 0) return unit(seconds / DAY, "day")
  if (seconds % HOUR === 0) return unit(seconds / HOUR, "hour")
  if (seconds >= MINUTE) return unit(Math.round(seconds / MINUTE), "minute")
  return unit(Math.max(1, Math.round(seconds)), "second")
}

/** 60 -> "every minute", 900 -> "every 15 minutes", 86400 -> "daily". */
export function formatInterval(seconds: number): string {
  if (seconds === MINUTE) return "every minute"
  if (seconds === HOUR) return "hourly"
  if (seconds === DAY) return "daily"
  return `every ${formatSpan(seconds)}`
}

/**
 * The reason line under a tick: its schedule and the gap past which the page
 * marks it stale, e.g. "Expected every 15 minutes · overdue after 45 minutes".
 */
export function describeSchedule(
  info: ScheduledJobInfo,
  staleAfterSeconds: number
): string {
  const threshold = `overdue after ${formatSpan(staleAfterSeconds)} without a run`
  if (info.intervalSeconds === null) {
    return threshold.charAt(0).toUpperCase() + threshold.slice(1)
  }
  return `Expected ${formatInterval(info.intervalSeconds)} · ${threshold}`
}

/**
 * Whether a tick is stale now. The server's flag is taken as-is; between
 * refetches the page also applies the same per-tick threshold to the clock,
 * so a row cannot read "16 minutes ago" unmarked while its neighbour at the
 * same age is marked. A tick that never completed is always stale.
 */
export function isTickStale(
  tick: {
    lastCompletedAt: string | null
    staleAfterSeconds: number
    stale: boolean
  },
  now: Date = new Date()
): boolean {
  if (tick.stale || !tick.lastCompletedAt) return true
  const completed = new Date(tick.lastCompletedAt).getTime()
  if (!Number.isFinite(completed)) return true
  return (now.getTime() - completed) / 1000 > tick.staleAfterSeconds
}

export type SchedulerSummary = {
  /**
   * `failing`: nothing is running; `some-stale`: some jobs are overdue;
   * `paused`: only paused jobs are out of step; `ok`: all on schedule.
   */
  state: "ok" | "paused" | "some-stale" | "failing"
  /** Overdue jobs (paused ones are not counted), and how many were reported. */
  overdue: number
  total: number
  /** Paused jobs: a pause is a choice, so these are never overdue. */
  paused: number
  /** One plain sentence or two: what it means and what to do. */
  message: string
}

/** ["a", "b", "c", "d"] -> "a, b, c and 1 more". */
function joinList(items: string[], max = 3): string {
  const shown = items.slice(0, max)
  const rest = items.length - shown.length
  const all = rest > 0 ? [...shown, `${rest} more`] : shown
  if (all.length === 1) return all[0]
  return `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`
}

/**
 * The page's one-line answer, from the same overdue rule the rows use.
 * Paused jobs (a pause scope holds them, lib/server/ops-liveness.ts) are
 * left out of the overdue and failing judgements, as the server's own
 * alerting leaves them out, and are named in a neutral note instead.
 * `failing` is the scheduler itself not reporting, or every running job
 * overdue: nothing is being processed. `some-stale` says what may be
 * delayed, from each overdue job's own `affects` text, and never guesses for
 * a job it has no words for.
 */
export function summariseScheduler(
  ticks: ReadonlyArray<{
    name: string
    lastCompletedAt: string | null
    staleAfterSeconds: number
    stale: boolean
    paused?: boolean
  }>,
  heartbeatStale: boolean,
  now: Date = new Date()
): SchedulerSummary {
  const pausedTicks = ticks.filter((tick) => tick.paused)
  const running = ticks.filter((tick) => !tick.paused)
  const overdueTicks = running.filter((tick) => isTickStale(tick, now))
  const overdue = overdueTicks.length
  const total = ticks.length
  const paused = pausedTicks.length
  const pausedNote = paused
    ? ` Paused: ${joinList(pausedTicks.map((tick) => scheduledJobInfo(tick.name).label))}. ${paused === 1 ? "It was" : "They were"} paused deliberately and ${paused === 1 ? "resumes" : "resume"} automatically when switched back on.`
    : ""
  if (heartbeatStale || (running.length > 0 && overdue === running.length)) {
    return {
      state: "failing",
      overdue,
      total,
      paused,
      message: `Background work isn't running. New reviews, listing updates and reply publishing won't be processed until it starts again. Contact support.${pausedNote}`,
    }
  }
  if (overdue > 0) {
    const areas = [
      ...new Set(
        overdueTicks
          .map((tick) => scheduledJobInfo(tick.name).affects)
          .filter((area): area is string => area !== null)
      ),
    ]
    const effect = areas.length
      ? `This may delay ${joinList(areas)}`
      : "This may delay some updates"
    const one = overdue === 1
    return {
      state: "some-stale",
      overdue,
      total,
      paused,
      message: `${one ? "1 background job hasn't" : `${overdue} background jobs haven't`} run recently. ${effect}; ${one ? "it" : "they"} should catch up on the next run. Contact support if this lasts more than a day.${pausedNote}`,
    }
  }
  if (paused > 0) {
    return {
      state: "paused",
      overdue,
      total,
      paused,
      message: pausedNote.trim(),
    }
  }
  return {
    state: "ok",
    overdue,
    total,
    paused,
    message: "Background jobs are running on schedule.",
  }
}
