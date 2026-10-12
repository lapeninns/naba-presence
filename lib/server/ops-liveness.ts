import "server-only"

import type {
  OperationsHealth,
  SchedulerTick,
} from "@/lib/contracts/operations"
import { getDatabase } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { SCHEDULER_TICK_NAMES } from "@/lib/server/leases"
import {
  loadPauseSnapshot,
  scopesEnabled,
  type PauseScope,
  type PauseSnapshot,
} from "@/lib/server/pause-controls"

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
  // 300s retention dispatcher, three intervals. A fire with no cycle to
  // work on still completes, so this is the dispatcher's liveness; whether
  // the walk finishes is TICK_CYCLE_STALE_AFTER_SECONDS below.
  retention: 900,
  // 3600s tick, three intervals. It completes while billing is disabled
  // too (nothing to reconcile), so its absence is always a fault unless
  // the operator `billing` scope pauses it.
  "billing-reconcile": 10_800,
  // 86400s ticks, two intervals.
  keywords: 172_800,
  sweep: 172_800,
}

/**
 * Lock skips in a row after which a tick's lease is treated as wedged: some
 * run, or a session that died holding the lock, has kept every scheduled
 * fire of the tick from doing anything. One or two skips are an overlapping
 * fire and are normal.
 */
export const TICK_LOCK_WEDGED_AFTER_SKIPS = 3

/**
 * Ticks whose work spans several runs, and how long each may go without
 * finishing a whole cycle. Only retention reports cycles: its five-minute
 * dispatcher opens one cycle per UTC day at 03:00 and reports it here through
 * `recordTickCycleCompleted` when every organisation has been retained
 * (lib/server/retention/cycle.ts). 26 hours is a day plus two hours for a
 * large fleet or a slow fire.
 */
export const TICK_CYCLE_STALE_AFTER_SECONDS: Record<string, number> = {
  retention: 93_600,
}

const SCHEDULER_STALE_AFTER_SECONDS = TICK_STALE_AFTER_SECONDS.jobs

/**
 * The pause scope that stops each tick's whole run (lib/server/pause-
 * controls.ts), env override or operator table. A paused tick is expected
 * not to complete -- retention and the review sync ticks answer 503, the
 * health tick evaluates nothing -- so it is reported as paused rather than
 * stale, and is not alerted on. presence-resources has no scope: nothing
 * pauses it, so its absence is always a fault. Neither do performance and
 * keywords: their cron GETs only enqueue checkpoints, and a pause of those
 * scopes holds the runner's claim, not the tick, so the tick keeps
 * completing and its absence is still a fault.
 */
export const TICK_PAUSE_SCOPES: Record<string, readonly PauseScope[]> = {
  jobs: ["jobs"],
  reconcile: ["sync"],
  sweep: ["sync"],
  retention: ["retention"],
  health: ["notifications"],
  "billing-reconcile": ["billing"],
}

/**
 * The ticks paused right now and the scopes holding them. An unreadable
 * pause table counts as not paused here: this feeds alerting, which must
 * keep paging on a dead tick when it cannot tell whether it was paused.
 */
export function pausedTicks(
  env: Parameters<typeof scopesEnabled>[0],
  snapshot: PauseSnapshot
): Map<string, PauseScope[]> {
  const paused = new Map<string, PauseScope[]>()
  for (const [tick, scopes] of Object.entries(TICK_PAUSE_SCOPES)) {
    const holding = scopes.filter(
      (scope) => !scopesEnabled(env, snapshot, [scope], "open")
    )
    if (holding.length) paused.set(tick, holding)
  }
  return paused
}

export type TickRow = {
  name: string
  beatAt: Date | null
  registeredAt: Date | null
  lastStartedAt: Date | null
  lastSkippedAt: Date | null
  consecutiveSkips: number
  lastFailedAt: Date | null
  lastErrorCode: string | null
  lastManualCompletedAt: Date | null
  lastCycleCompletedAt: Date | null
}

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null

const secondsSince = (value: Date | null | undefined, now: Date) =>
  value ? (now.getTime() - value.getTime()) / 1000 : null

/**
 * Per-tick liveness from the run ledger, one entry per scheduled tick in
 * report order. A tick with no row reads as never completed and never
 * registered (so no grace anchor), which is what a database without 0089's
 * seed rows looks like. `paused` names the ticks a pause scope holds and
 * which scopes (pausedTicks).
 */
export function tickLiveness(
  rows: readonly TickRow[],
  now: Date,
  paused: ReadonlyMap<string, readonly PauseScope[]> = new Map()
): SchedulerTick[] {
  const byName = new Map(rows.map((row) => [row.name, row]))
  return SCHEDULER_TICK_NAMES.map((name) => {
    const row = byName.get(name)
    const age = secondsSince(row?.beatAt, now)
    const staleAfterSeconds =
      TICK_STALE_AFTER_SECONDS[name] ?? SCHEDULER_STALE_AFTER_SECONDS
    const cycleStaleAfterSeconds = TICK_CYCLE_STALE_AFTER_SECONDS[name] ?? null
    // A tick that has never finished a cycle is measured from registration,
    // like a tick that has never completed, so a fresh deploy gets a full
    // window before it pages.
    const cycleAge = secondsSince(
      row?.lastCycleCompletedAt ?? row?.registeredAt,
      now
    )
    const consecutiveSkips = row?.consecutiveSkips ?? 0
    return {
      name,
      lastCompletedAt: iso(row?.beatAt),
      staleAfterSeconds,
      stale: age === null || age > staleAfterSeconds,
      neverCompleted: !row?.beatAt,
      registeredAt: iso(row?.registeredAt),
      lastStartedAt: iso(row?.lastStartedAt),
      lastSkippedAt: iso(row?.lastSkippedAt),
      consecutiveSkips,
      lockWedged: consecutiveSkips >= TICK_LOCK_WEDGED_AFTER_SKIPS,
      lastFailedAt: iso(row?.lastFailedAt),
      lastErrorCode: row?.lastErrorCode ?? null,
      lastManualCompletedAt: iso(row?.lastManualCompletedAt),
      lastCycleCompletedAt: iso(row?.lastCycleCompletedAt),
      cycleStaleAfterSeconds,
      cycleStale:
        cycleStaleAfterSeconds !== null &&
        cycleAge !== null &&
        cycleAge > cycleStaleAfterSeconds,
      paused: paused.has(name),
      pausedScopes: [...(paused.get(name) ?? [])],
    }
  })
}

export type TickFinding = {
  kind:
    | "stale_heartbeat"
    | "tick_never_completed"
    | "tick_lock_wedged"
    | "tick_cycle_overdue"
    | "tick_cycle_failures"
  subject: string
  details: Record<string, unknown>
}

/**
 * The tick problems worth paging an operator about. Each tick yields at most
 * one of "stopped" (it used to complete and has not since) or "never
 * completed" (past the grace from its registration), plus a wedged lease and
 * an overdue cycle independently.
 *
 * The health tick is left out: it is the one evaluating, so it cannot report
 * its own absence, and on its very first run it has not completed yet. Its
 * absence is reported by the readiness endpoint (lib/server/readiness.ts) to
 * a probe outside the deployment.
 *
 * A paused tick (TICK_PAUSE_SCOPES) raises no stopped, never-completed or
 * overdue-cycle finding: not completing is what a pause is. Its open
 * incidents resolve, and if it still does not complete once the pause is
 * lifted, the next evaluation opens them again. A wedged lease is still
 * reported, because a paused tick does not take its lease at all.
 */
export function tickFindings(
  ticks: readonly SchedulerTick[],
  now: Date
): TickFinding[] {
  const findings: TickFinding[] = []
  for (const tick of ticks) {
    if (tick.name === "health") continue
    if (tick.paused) {
      if (tick.lockWedged) {
        findings.push({
          kind: "tick_lock_wedged",
          subject: tick.name,
          details: {
            consecutiveSkips: tick.consecutiveSkips,
            lastSkippedAt: tick.lastSkippedAt,
            lastStartedAt: tick.lastStartedAt,
          },
        })
      }
      continue
    }
    const failure = {
      lastStartedAt: tick.lastStartedAt,
      lastFailedAt: tick.lastFailedAt,
      lastErrorCode: tick.lastErrorCode,
    }
    if (tick.stale && tick.lastCompletedAt) {
      findings.push({
        kind: "stale_heartbeat",
        subject: tick.name,
        details: {
          lastCompletedAt: tick.lastCompletedAt,
          staleAfterSeconds: tick.staleAfterSeconds,
          ...failure,
        },
      })
    } else if (tick.neverCompleted) {
      // No registration means no anchor to measure the grace from; the
      // health endpoint still reports the tick as stale.
      const sinceRegistered = tick.registeredAt
        ? (now.getTime() - Date.parse(tick.registeredAt)) / 1000
        : null
      if (
        sinceRegistered !== null &&
        sinceRegistered > tick.staleAfterSeconds
      ) {
        findings.push({
          kind: "tick_never_completed",
          subject: tick.name,
          details: {
            registeredAt: tick.registeredAt,
            staleAfterSeconds: tick.staleAfterSeconds,
            lastManualCompletedAt: tick.lastManualCompletedAt,
            ...failure,
          },
        })
      }
    }
    if (tick.lockWedged) {
      findings.push({
        kind: "tick_lock_wedged",
        subject: tick.name,
        details: {
          consecutiveSkips: tick.consecutiveSkips,
          lastSkippedAt: tick.lastSkippedAt,
          lastStartedAt: tick.lastStartedAt,
        },
      })
    }
    if (tick.cycleStale) {
      findings.push({
        kind: "tick_cycle_overdue",
        subject: tick.name,
        details: {
          lastCycleCompletedAt: tick.lastCycleCompletedAt,
          registeredAt: tick.registeredAt,
          cycleStaleAfterSeconds: tick.cycleStaleAfterSeconds,
        },
      })
    }
  }
  return findings
}

type SchedulerLiveness = Pick<
  OperationsHealth,
  "schedulerHeartbeatAt" | "schedulerHeartbeatStale" | "schedulerTicks"
>

/**
 * Liveness for the scheduler process and for each tick it drives.
 *
 * `schedulerHeartbeatAt` is still the row the jobs tick writes even while
 * paused, so it keeps meaning "the scheduler reached the web process". Each
 * per-tick row is the tick's run ledger, written by its advisory lease
 * (lib/server/leases.ts): a tick that has been failing, skipping on a wedged
 * lock, or never completed reports as stale instead of hiding behind the jobs
 * tick's heartbeat, and says which.
 */
export async function schedulerLiveness(
  now: Date = new Date()
): Promise<SchedulerLiveness> {
  // Platform-level read: ops_heartbeat is not tenant-scoped, so it is read
  // outside withTenant.
  const rows = await getDatabase()<TickRow[]>`
    select
      name,
      beat_at as "beatAt",
      registered_at as "registeredAt",
      last_started_at as "lastStartedAt",
      last_skipped_at as "lastSkippedAt",
      consecutive_skips as "consecutiveSkips",
      last_failed_at as "lastFailedAt",
      last_error_code as "lastErrorCode",
      last_manual_completed_at as "lastManualCompletedAt",
      last_cycle_completed_at as "lastCycleCompletedAt"
    from ops_heartbeat
  `
  const paused = pausedTicks(getServerEnv(), await loadPauseSnapshot())
  const scheduler = rows.find((row) => row.name === "scheduler")?.beatAt
  const schedulerAge = secondsSince(scheduler, now)
  return {
    // Normalised here so the tenant projection below can be checked against
    // the wire contract; `NextResponse.json` would have emitted the same ISO
    // string from the `Date`.
    schedulerHeartbeatAt: iso(scheduler),
    schedulerHeartbeatStale:
      schedulerAge === null || schedulerAge > SCHEDULER_STALE_AFTER_SECONDS,
    schedulerTicks: tickLiveness(rows, now, paused),
  }
}

/**
 * A `publishing` occurrence is reaped to `ambiguous` by the next claim once
 * its schedule's lease (the jobs tick budget plus a minute, under two
 * minutes) has run out. Ten minutes past its start with the lease gone means
 * the claim has not run for several ticks.
 */
export const SCHEDULED_POST_STUCK_AFTER_SECONDS = 600
/**
 * The every-tick sweep records a `scheduled` occurrence missed at its
 * deadline, but only inside the `naba:jobs` advisory lock: a tick that
 * overruns its 45 s budget makes the next minute's run skip the lock, so the
 * sweep can lag about two minutes for a transient reason. Three minutes (two
 * jobs periods plus the budget, rounded up) keeps one slow tick from paging
 * operators; a lock that stays held is `tick_lock_wedged`'s alert.
 */
export const SCHEDULED_POST_OVERDUE_AFTER_SECONDS = 180
/** The scopes the scheduled post path runs under in the jobs tick. */
export const SCHEDULED_POST_PAUSE_SCOPES: readonly PauseScope[] = [
  "jobs",
  "publish",
  "scheduled_post",
]

export type ScheduledPostHealthRow = {
  organisationId: string
  stuckPublishing: number
  oldestStartedAt: Date | null
  overdueScheduled: number
  oldestDeadlineAt: Date | null
}

export type ScheduledPostFinding = {
  kind: "scheduled_post_stuck" | "scheduled_post_overdue"
  subject: string
  details: Record<string, unknown>
}

/**
 * Scheduled post occurrences the job tick should have moved on and has not
 * (P08-R6), one finding per organisation and kind; the subject is the
 * organisation id, and the details hold counts and instants only.
 *
 * An overdue `scheduled` occurrence is reported whatever the pauses say: the
 * sweep that records it missed runs before any pause check. A stuck
 * `publishing` one is not reported while the scheduled post path is paused,
 * because the claim that reaps it is held by that pause; it is reaped (and
 * becomes unresolved, never resent) once the pause lifts, and reported if
 * it still is not.
 */
export function scheduledPostFindings(
  rows: readonly ScheduledPostHealthRow[],
  scheduledPostPaused: boolean
): ScheduledPostFinding[] {
  const findings: ScheduledPostFinding[] = []
  for (const row of rows) {
    if (row.stuckPublishing > 0 && !scheduledPostPaused) {
      findings.push({
        kind: "scheduled_post_stuck",
        subject: row.organisationId,
        details: {
          occurrences: row.stuckPublishing,
          oldestStartedAt: iso(row.oldestStartedAt),
          stuckAfterSeconds: SCHEDULED_POST_STUCK_AFTER_SECONDS,
        },
      })
    }
    if (row.overdueScheduled > 0) {
      findings.push({
        kind: "scheduled_post_overdue",
        subject: row.organisationId,
        details: {
          occurrences: row.overdueScheduled,
          oldestDeadlineAt: iso(row.oldestDeadlineAt),
          overdueAfterSeconds: SCHEDULED_POST_OVERDUE_AFTER_SECONDS,
        },
      })
    }
  }
  return findings
}

/**
 * Reads post_schedule_health() (0121), across tenants through its security
 * definer like the tick's sweep, and turns it into findings. An unreadable
 * pause table counts as not paused, as for the tick findings.
 */
export async function scheduledPostHealth(): Promise<ScheduledPostFinding[]> {
  const rows = await getDatabase()<ScheduledPostHealthRow[]>`
    select organisation_id::text as "organisationId",
      stuck_publishing as "stuckPublishing",
      oldest_started_at as "oldestStartedAt",
      overdue_scheduled as "overdueScheduled",
      oldest_deadline_at as "oldestDeadlineAt"
    from post_schedule_health(
      ${SCHEDULED_POST_STUCK_AFTER_SECONDS},
      ${SCHEDULED_POST_OVERDUE_AFTER_SECONDS}
    )
  `
  const paused = !scopesEnabled(
    getServerEnv(),
    await loadPauseSnapshot(),
    SCHEDULED_POST_PAUSE_SCOPES,
    "open"
  )
  return scheduledPostFindings(rows, paused)
}
