import "server-only"

import type {
  PlatformRelease,
  ReadinessReason,
  ReadinessResponse,
  ReadinessStatus,
  ReadinessTick,
  SchedulerTick,
  TelemetryStatus,
} from "@/lib/contracts/operations"
import { getDatabase } from "@/lib/server/db"
import { getServerEnv, type ServerEnv } from "@/lib/server/env"
import { emailConfigured } from "@/lib/server/notifications/email"
import { schedulerLiveness } from "@/lib/server/ops-liveness"
import {
  loadPauseSnapshot,
  pausedScopes,
  type PauseScope,
} from "@/lib/server/pause-controls"
import { releaseInfo, type ReleaseInfo } from "@/lib/server/release"
import {
  missingMigrations,
  readAppliedMigrations,
} from "@/lib/server/schema-compat"
import { REQUIRED_MIGRATIONS } from "@/lib/server/schema-manifest"
import { telemetryStatus } from "@/lib/server/telemetry-status"

/**
 * Readiness: whether this deployment can be trusted to be doing its job,
 * for a probe outside it (scripts/ops/readiness-probe.mjs).
 *
 * The health tick alerts on everything else, but it cannot alert on its own
 * absence, nor on a paused notifications scope, an unconfigured email
 * provider, or an alert that failed to send: each of those silences the
 * in-app alerting itself. This endpoint answers those from outside the tick,
 * with a fixed handful of platform-level reads and no tenant walk, so a probe
 * can call it every few minutes.
 *
 * `evaluateReadiness` is pure; `loadReadinessInputs` gathers its inputs and
 * turns each read's failure into an "unknown" the evaluation judges, rather
 * than a 500 the probe would have to interpret.
 */

export type ReadinessInputs = {
  database: { reachable: boolean }
  release: ReleaseInfo
  schema: PlatformRelease["schema"]
  /** Null when the database was unreachable or the ledger unreadable. */
  scheduler: { heartbeatAt: string | null; stale: boolean } | null
  ticks: readonly SchedulerTick[]
  pause: { scopes: readonly PauseScope[]; readFailed: boolean }
  email: {
    provider: ServerEnv["EMAIL_PROVIDER"]
    configured: boolean
    opsRecipients: number
  }
  telemetry: TelemetryStatus
  incidents: ReadinessResponse["incidents"]
}

export type ReadinessEvaluation = {
  status: ReadinessStatus
  reasons: ReadinessReason[]
  ticks: ReadinessTick[]
}

const reason = (
  code: string,
  severity: ReadinessReason["severity"],
  subject: string | null = null
): ReadinessReason => ({ code, severity, subject })

/**
 * One tick's state. A paused tick is expected not to complete, so it is
 * `paused` whatever its age. A tick that has never completed is
 * `awaiting_first_run` inside its grace from registration (0089) and
 * `never_completed` past it, or with no registration to measure from:
 * the same rule tickFindings applies, here for the health tick too.
 */
function tickState(tick: SchedulerTick, now: Date): ReadinessTick["state"] {
  if (tick.paused) return "paused"
  if (!tick.stale) return "ok"
  if (tick.lastCompletedAt) return "stale"
  const sinceRegistered = tick.registeredAt
    ? (now.getTime() - Date.parse(tick.registeredAt)) / 1000
    : null
  return sinceRegistered !== null && sinceRegistered <= tick.staleAfterSeconds
    ? "awaiting_first_run"
    : "never_completed"
}

/**
 * The verdict. `not_ready` (503) is anything that means work or alerting has
 * stopped with nobody told: no database, a schema this build cannot run on,
 * a silent scheduler, a stopped, never-run or wedged tick (the health tick
 * included), or an open platform incident no operator was told about.
 * `degraded` (200) is a deployment that works but is running blind or held:
 * a pause in force, an unreadable pause table, no alert email, metrics not
 * exported, an unknown release, an overdue retention cycle, quota pressure,
 * a tick still inside its first-run grace, or an incident read that failed.
 */
export function evaluateReadiness(
  inputs: ReadinessInputs,
  now: Date
): ReadinessEvaluation {
  const reasons: ReadinessReason[] = []
  const ticks: ReadinessTick[] = []

  if (!inputs.database.reachable) {
    reasons.push(reason("database_unreachable", "not_ready"))
  }

  if (inputs.schema.compatible === false) {
    for (const version of inputs.schema.missing) {
      reasons.push(reason("schema_incompatible", "not_ready", version))
    }
    if (inputs.schema.missing.length === 0) {
      reasons.push(reason("schema_incompatible", "not_ready"))
    }
  } else if (inputs.schema.compatible === null && inputs.database.reachable) {
    reasons.push(reason("schema_unknown", "not_ready"))
  }

  if (inputs.release.source === "unknown") {
    reasons.push(reason("release_unknown", "degraded"))
  }

  if (inputs.database.reachable) {
    if (!inputs.scheduler) {
      reasons.push(reason("scheduler_unknown", "not_ready"))
    } else if (inputs.scheduler.stale) {
      reasons.push(reason("scheduler_silent", "not_ready"))
    }
  }

  for (const tick of inputs.ticks) {
    const state = tickState(tick, now)
    ticks.push({
      name: tick.name,
      state,
      lastCompletedAt: tick.lastCompletedAt,
      staleAfterSeconds: tick.staleAfterSeconds,
      lockWedged: tick.lockWedged,
      cycleStale: tick.cycleStale,
    })
    if (state === "stale") {
      reasons.push(reason("tick_stale", "not_ready", tick.name))
    } else if (state === "never_completed") {
      reasons.push(reason("tick_never_completed", "not_ready", tick.name))
    } else if (state === "awaiting_first_run") {
      reasons.push(reason("tick_awaiting_first_run", "degraded", tick.name))
    }
    // A paused tick does not take its lease, so a wedge is someone else
    // holding it and is reported paused or not.
    if (tick.lockWedged) {
      reasons.push(reason("tick_lock_wedged", "not_ready", tick.name))
    }
    if (tick.cycleStale && !tick.paused) {
      reasons.push(reason("tick_cycle_overdue", "degraded", tick.name))
    }
  }

  for (const scope of inputs.pause.scopes) {
    reasons.push(reason("pause_active", "degraded", scope))
  }
  // Notifications paused is every alert silenced, operator alerts included:
  // called out on its own so the probe's message says so.
  if (inputs.pause.scopes.includes("notifications")) {
    reasons.push(reason("alerting_paused", "degraded"))
  }
  if (inputs.pause.readFailed && inputs.database.reachable) {
    reasons.push(reason("pause_state_unknown", "degraded"))
  }

  if (!inputs.email.configured) {
    reasons.push(reason("email_not_configured", "degraded"))
  }
  if (inputs.email.opsRecipients === 0) {
    reasons.push(reason("ops_recipients_missing", "degraded"))
  }

  if (inputs.telemetry.state === "disabled") {
    reasons.push(
      reason("telemetry_disabled", "degraded", inputs.telemetry.reason)
    )
  } else if (inputs.telemetry.state === "failing") {
    reasons.push(reason("telemetry_failing", "degraded"))
  }

  if (inputs.incidents) {
    if (inputs.incidents.undelivered > 0) {
      reasons.push(reason("alert_undelivered", "not_ready"))
    }
    if (inputs.incidents.quotaPressure > 0) {
      reasons.push(reason("google_quota_pressure", "degraded"))
    }
  } else if (inputs.database.reachable) {
    reasons.push(reason("incidents_unknown", "degraded"))
  }

  const status: ReadinessStatus = reasons.some(
    (entry) => entry.severity === "not_ready"
  )
    ? "not_ready"
    : reasons.length
      ? "degraded"
      : "ready"
  return { status, reasons, ticks }
}

/**
 * Each database read gives up after this, so a hung pool cannot hang the
 * probe. The connectivity check runs first and the remaining reads together
 * after it, so an answer takes at most two of these: inside the probe's
 * default --timeout-ms of 15 seconds.
 */
export const READINESS_READ_TIMEOUT_MS = 5_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("readiness_read_timeout")), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

async function attempt<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await withTimeout(read(), READINESS_READ_TIMEOUT_MS)
  } catch {
    return null
  }
}

/**
 * Open platform incidents in three counts. `undelivered` is an open incident
 * whose alert summary settled without any send (0050's notify_status:
 * `failed` once every recipient failed or is uncertain, `suppressed` once
 * every delivery was suppressed or there were no recipients); an incident
 * still sending reads null there and is not counted.
 */
async function readIncidents(): Promise<
  NonNullable<ReadinessInputs["incidents"]>
> {
  const [row] = await getDatabase()<
    { open: number; undelivered: number; quotaPressure: number }[]
  >`
    select
      count(*)::integer as open,
      count(*) filter (
        where notify_status in ('failed', 'suppressed')
      )::integer as undelivered,
      count(*) filter (
        where kind = 'google_quota_pressure'
      )::integer as "quotaPressure"
    from platform_incident
    where status = 'open'
  `
  return row ?? { open: 0, undelivered: 0, quotaPressure: 0 }
}

/**
 * Every input, read once. Platform-level reads only, all outside withTenant:
 * a connectivity check, then together the migration ledger, ops_heartbeat
 * (through schedulerLiveness), the cached pause snapshot and one aggregate
 * over platform_incident. Nothing here grows with the number of
 * organisations (tests/integration/readiness-bounded.test.ts counts them).
 */
export async function loadReadinessInputs(
  now: Date = new Date()
): Promise<ReadinessInputs> {
  const env = getServerEnv()
  const reachable =
    (await attempt(async () => {
      await getDatabase()`select 1`
      return true
    })) ?? false

  // With the database unreachable nothing else is read: each read would
  // only wait out its own connect timeout. Past the connectivity check the
  // reads are independent, so they run together. The pause snapshot read
  // reports its own failure as `readFailed`; the limit covers a hang.
  const [applied, liveness, snapshot, incidents] = reachable
    ? await Promise.all([
        attempt(readAppliedMigrations),
        attempt(() => schedulerLiveness(now)),
        attempt(loadPauseSnapshot),
        attempt(readIncidents),
      ])
    : ([null, null, null, null] as const)
  const missing = applied ? missingMigrations(applied) : []
  const schema: PlatformRelease["schema"] = {
    compatible: applied ? missing.length === 0 : null,
    requiredCount: REQUIRED_MIGRATIONS.length,
    missing,
  }
  // Scopes are listed with the env layer applied, so an env flag that is off
  // shows here as well; with the table unread, only that layer is known.
  const pauseScopes =
    snapshot && !snapshot.readFailed
      ? pausedScopes(env, snapshot)
      : pausedScopesFromEnv(env)

  return {
    database: { reachable },
    release: releaseInfo(),
    schema,
    scheduler: liveness
      ? {
          heartbeatAt: liveness.schedulerHeartbeatAt,
          stale: liveness.schedulerHeartbeatStale,
        }
      : null,
    ticks: liveness?.schedulerTicks ?? [],
    pause: {
      scopes: pauseScopes,
      readFailed: !snapshot || snapshot.readFailed,
    },
    email: {
      provider: env.EMAIL_PROVIDER,
      configured: emailConfigured(),
      opsRecipients: env.OPS_ALERT_EMAILS.length,
    },
    telemetry: telemetryStatus(),
    incidents,
  }
}

/** With the table unreadable, only the env layer is known. */
function pausedScopesFromEnv(env: ServerEnv): PauseScope[] {
  return pausedScopes(env, { paused: new Set(), readFailed: false })
}

/** The readiness response, judged at `now`. */
export async function readiness(
  now: Date = new Date()
): Promise<ReadinessResponse> {
  const inputs = await loadReadinessInputs(now)
  const evaluation = evaluateReadiness(inputs, now)
  return {
    status: evaluation.status,
    ok: evaluation.status !== "not_ready",
    generatedAt: now.toISOString(),
    reasons: evaluation.reasons,
    release: inputs.release,
    schema: inputs.schema,
    database: inputs.database,
    scheduler: inputs.scheduler,
    ticks: evaluation.ticks,
    pause: {
      scopes: [...inputs.pause.scopes],
      readFailed: inputs.pause.readFailed,
    },
    email: inputs.email,
    telemetry: inputs.telemetry,
    incidents: inputs.incidents,
  }
}
