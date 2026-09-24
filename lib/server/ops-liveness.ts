import "server-only"

import type { OperationsHealth } from "@/lib/contracts/operations"
import { getDatabase } from "@/lib/server/db"
import { SCHEDULER_TICK_NAMES } from "@/lib/server/leases"

/**
 * How long each tick may go without completing before its absence is worth
 * acting on: a small multiple of the interval `scripts/scheduler.mjs`
 * documents for it, so one missed run is noise and a stopped tick is not.
 * Change these together with the scheduler's defaults.
 */
export const TICK_STALE_AFTER_SECONDS: Record<string, number> = {
  // 60s tick; matches the five-minute "scheduler silent" rule in
  // docs/observability.md.
  jobs: 300,
  // 900s ticks, three intervals.
  reconcile: 2_700,
  "presence-resources": 2_700,
  // 21600s tick, three intervals.
  performance: 64_800,
  // 900s tick; notifications and alerts are evaluated on it.
  health: 2_700,
  // 86400s ticks, two intervals.
  retention: 172_800,
  keywords: 172_800,
  sweep: 172_800,
}

const SCHEDULER_STALE_AFTER_SECONDS = TICK_STALE_AFTER_SECONDS.jobs

type SchedulerLiveness = Pick<
  OperationsHealth,
  "schedulerHeartbeatAt" | "schedulerHeartbeatStale" | "schedulerTicks"
>

/**
 * Liveness for the scheduler process and for each tick it drives.
 *
 * `schedulerHeartbeatAt` is still the row the jobs tick writes even while
 * paused, so it keeps meaning "the scheduler reached the web process". Each
 * per-tick row is stamped by that tick's advisory lease on a completed run
 * (lib/server/leases.ts), so a tick that has been failing, skipping on a
 * wedged lock, or never registered at all reports as stale instead of hiding
 * behind the jobs tick's heartbeat.
 */
export async function schedulerLiveness(): Promise<SchedulerLiveness> {
  // Platform-level read: ops_heartbeat is not tenant-scoped, so it is read
  // outside withTenant.
  const rows = await getDatabase()<{ name: string; beatAt: Date }[]>`
    select name, beat_at as "beatAt"
    from ops_heartbeat
  `
  const beats = new Map(rows.map((row) => [row.name, row.beatAt]))
  const ageSeconds = (beatAt: Date | undefined) =>
    beatAt ? (Date.now() - beatAt.getTime()) / 1000 : null
  const scheduler = beats.get("scheduler")
  const schedulerAge = ageSeconds(scheduler)
  return {
    // Normalised here so the tenant projection below can be checked against
    // the wire contract; `NextResponse.json` would have emitted the same ISO
    // string from the `Date`.
    schedulerHeartbeatAt: scheduler?.toISOString() ?? null,
    schedulerHeartbeatStale:
      schedulerAge === null || schedulerAge > SCHEDULER_STALE_AFTER_SECONDS,
    schedulerTicks: SCHEDULER_TICK_NAMES.map((name) => {
      const beatAt = beats.get(name)
      const age = ageSeconds(beatAt)
      const staleAfterSeconds =
        TICK_STALE_AFTER_SECONDS[name] ?? SCHEDULER_STALE_AFTER_SECONDS
      return {
        name,
        lastCompletedAt: beatAt?.toISOString() ?? null,
        staleAfterSeconds,
        stale: age === null || age > staleAfterSeconds,
      }
    }),
  }
}

