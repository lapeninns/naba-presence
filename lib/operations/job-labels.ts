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
  /** Scheduled interval in seconds; null when the key is unknown. */
  intervalSeconds: number | null
}

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const SCHEDULED_JOBS: Record<string, ScheduledJobInfo> = {
  jobs: {
    label: "Job runner",
    purpose: "Works through queued syncs, review events and reply publishing.",
    intervalSeconds: MINUTE,
  },
  reconcile: {
    label: "Review check",
    purpose:
      "Queues a check of every linked location for new or changed reviews.",
    intervalSeconds: 15 * MINUTE,
  },
  "presence-resources": {
    label: "Listing sync",
    purpose:
      "Reads hours, profile, posts, photos, menus and action links from Google.",
    intervalSeconds: 15 * MINUTE,
  },
  performance: {
    label: "Performance metrics",
    purpose: "Queues a refresh of Google search and Maps performance figures.",
    intervalSeconds: 6 * HOUR,
  },
  sweep: {
    label: "Full review sweep",
    purpose:
      "Queues a full pass over each location's reviews to catch deletions and gaps.",
    intervalSeconds: DAY,
  },
  keywords: {
    label: "Search keywords",
    purpose:
      "Queues a refresh of the search terms that led people to listings.",
    intervalSeconds: DAY,
  },
  retention: {
    label: "Data retention clean-up",
    purpose:
      "Redacts expired Google content and deletes records past their retention period.",
    intervalSeconds: DAY,
  },
  health: {
    label: "Health checks",
    purpose:
      "Evaluates every organisation for incidents and sends due notifications.",
    intervalSeconds: 15 * MINUTE,
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
 * marks it stale, e.g. "Expected every 15 minutes · stale after 45 minutes".
 */
export function describeSchedule(
  info: ScheduledJobInfo,
  staleAfterSeconds: number
): string {
  const threshold = `stale after ${formatSpan(staleAfterSeconds)} without a run`
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
