import "server-only"

import { randomUUID } from "node:crypto"

import type { Sql } from "postgres"

import { getDatabase } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"

/**
 * One fleet lease per scheduled tick. The suffix after `naba:` is also the
 * `ops_heartbeat` row the tick's runs are recorded in, so the lock
 * namespace and the liveness names are defined together and cannot drift.
 */
export const LEASE_KEYS = [
  "naba:jobs",
  "naba:reconcile",
  "naba:retention",
  "naba:performance",
  "naba:keywords",
  "naba:presence-resources",
  "naba:sweep",
  "naba:health",
  // The hourly Stripe reconciliation (app/api/billing/reconcile, P07-S4).
  "naba:billing-reconcile",
] as const

export type LeaseKey = (typeof LEASE_KEYS)[number]

/**
 * `ops_heartbeat.name` for every tick whose lease a route actually takes, in
 * the order the health route reports them. The sweep's fleet enqueue takes
 * `naba:sweep`, so every tick is listed.
 */
export const SCHEDULER_TICK_NAMES: readonly string[] = LEASE_KEYS.map((key) =>
  key.slice("naba:".length)
)

function tickName(key: LeaseKey): string {
  return key.slice("naba:".length)
}

/**
 * Who started the run. `cron` is the scheduled tick the liveness alerts are
 * about; `manual` is an owner or admin refreshing their own organisation
 * under the same fleet lease. A manual run is recorded on its own column and
 * never moves the tick's heartbeat, its skip streak or its failure, so a busy
 * customer pressing refresh cannot make a dead cron look alive.
 */
export type TickTrigger = "cron" | "manual"

type TickEvent = "started" | "skipped" | "completed" | "failed"

function errorCodeOf(error: unknown): string {
  // Only a stable machine code is kept: messages can carry tenant or Google
  // detail, and this row is platform-level.
  if (error instanceof ApiError) return error.code.slice(0, 64)
  return "internal_error"
}

/**
 * Writes one event of a tick's run into its `ops_heartbeat` row (0089).
 *
 * `beat_at` still means "a scheduled run under this lease completed": it is
 * written only on a completed cron run. A lock skip proves nothing about the
 * tick, so it records `last_skipped_at` and lengthens `consecutive_skips`
 * instead; a throw records `last_failed_at` and its code and leaves `beat_at`
 * where it was, so "no heartbeat since" is still exactly the staleness the
 * health route alerts on. Taking the lease ends the skip streak.
 *
 * Data freshness is what `reconcileStalenessSeconds` covers; this is
 * liveness.
 */
async function recordTickEvent(
  connection: Sql,
  key: LeaseKey,
  trigger: TickTrigger,
  event: TickEvent,
  error?: unknown
) {
  const name = tickName(key)
  try {
    // Platform-level write: ops_heartbeat is not tenant-scoped (0009), so it
    // is written outside withTenant, on the connection that tried the lease.
    if (trigger === "manual") {
      if (event !== "completed") return
      await connection`
        insert into ops_heartbeat (name, last_manual_completed_at)
        values (${name}, now())
        on conflict (name) do update
        set last_manual_completed_at = excluded.last_manual_completed_at
      `
      return
    }
    if (event === "started") {
      await connection`
        insert into ops_heartbeat (name, last_started_at)
        values (${name}, now())
        on conflict (name) do update
        set last_started_at = excluded.last_started_at,
            consecutive_skips = 0
      `
    } else if (event === "skipped") {
      await connection`
        insert into ops_heartbeat (name, last_skipped_at, consecutive_skips)
        values (${name}, now(), 1)
        on conflict (name) do update
        set last_skipped_at = excluded.last_skipped_at,
            consecutive_skips = ops_heartbeat.consecutive_skips + 1
      `
    } else if (event === "completed") {
      await connection`
        insert into ops_heartbeat (name, beat_at)
        values (${name}, now())
        on conflict (name) do update
        set beat_at = excluded.beat_at
      `
    } else {
      await connection`
        insert into ops_heartbeat (name, last_failed_at, last_error_code)
        values (${name}, now(), ${errorCodeOf(error)})
        on conflict (name) do update
        set last_failed_at = excluded.last_failed_at,
            last_error_code = excluded.last_error_code
      `
    }
  } catch (writeError) {
    // Liveness bookkeeping must never change the tick's own outcome; a missed
    // stamp reads as staleness, which is the safe direction.
    log.warn("leases.heartbeat_failed", { key, event, error: writeError })
  }
}

/**
 * Records that a run of a multi-run tick finished a whole cycle: for the
 * retention walk, one pass over every organisation. Liveness alerts when no
 * cycle completes within the tick's cycle window (ops-liveness.ts
 * `TICK_CYCLE_STALE_AFTER_SECONDS`), however healthy the individual runs are.
 * Call it from inside the leased run, after the cycle's last page.
 */
export async function recordTickCycleCompleted(key: LeaseKey) {
  try {
    await getDatabase()`
      insert into ops_heartbeat (name, last_cycle_completed_at)
      values (${tickName(key)}, now())
      on conflict (name) do update
      set last_cycle_completed_at = excluded.last_cycle_completed_at
    `
  } catch (error) {
    log.warn("leases.heartbeat_failed", { key, event: "cycle", error })
  }
}

/**
 * How long a fleet lease lasts without renewal. Above the maxDuration (60 s)
 * of every route that takes one, so a healthy tick never loses its lease,
 * and a tick that was frozen or killed holding it frees it within this bound.
 */
export const FLEET_LEASE_SECONDS = 90

/** A run still going renews its lease this often, well inside the expiry. */
const FLEET_LEASE_RENEW_MS = 30_000

async function renewFleetLease(connection: Sql, name: string, holder: string) {
  try {
    const renewed = await connection`
      update fleet_lease
      set expires_at = now() + make_interval(secs => ${FLEET_LEASE_SECONDS})
      where name = ${name}
        and holder = ${holder}
      returning name
    `
    // Only possible after this holder stopped renewing for a whole expiry
    // (a frozen instance that thawed): another tick may now hold the lease.
    if (!renewed.length) log.warn("leases.lease_lost", { key: name })
  } catch (error) {
    log.warn("leases.renew_failed", { key: name, error })
  }
}

/**
 * Runs `fn` under the tick's fleet lease (0145), or returns `{ skipped }`
 * when another run holds it.
 *
 * The lease is an expiring row rather than a session advisory lock: an
 * advisory lock lives as long as its connection, so a function frozen with
 * the socket open could hold a tick's lock indefinitely and skip every later
 * fire (audit W8-05). A row whose expiry has passed is free to take. The
 * holder renews it while `fn` runs; a frozen holder stops renewing, so its
 * lease lapses within FLEET_LEASE_SECONDS. A crashed holder no longer frees
 * the lease at once, as a closed connection did: the next fire after the
 * expiry takes it.
 *
 * Plain pooled statements, so a tick no longer holds a session-pooler
 * connection for its whole run.
 *
 * `options.scope` narrows the lease to one subject under the tick (an
 * organisation's own sync now: `naba:reconcile:<organisationId>`), so tenants
 * never wait on each other's manual runs. The run is still recorded on the
 * tick's heartbeat row.
 */
export async function withFleetLease<T>(
  key: LeaseKey,
  fn: () => Promise<T>,
  options: { trigger?: TickTrigger; scope?: string } = {}
): Promise<T | { skipped: true }> {
  const trigger = options.trigger ?? "cron"
  const name = options.scope ? `${key}:${options.scope}` : key
  const connection = getDatabase()
  const holder = randomUUID()
  // Concurrent takers serialise on the row: the loser re-checks the expiry
  // against the winner's row and updates nothing.
  const [taken] = await connection<{ name: string }[]>`
    insert into fleet_lease (name, holder, acquired_at, expires_at)
    values (
      ${name},
      ${holder},
      now(),
      now() + make_interval(secs => ${FLEET_LEASE_SECONDS})
    )
    on conflict (name) do update
    set holder = excluded.holder,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
    where fleet_lease.expires_at <= now()
    returning name
  `
  if (!taken) {
    await recordTickEvent(connection, key, trigger, "skipped")
    return { skipped: true }
  }
  // Renewals are chained, so the release below can wait for the last one
  // and never be overtaken by it.
  let renewal: Promise<void> = Promise.resolve()
  const timer = setInterval(() => {
    renewal = renewal.then(() => renewFleetLease(connection, name, holder))
  }, FLEET_LEASE_RENEW_MS)
  timer.unref?.()
  try {
    await recordTickEvent(connection, key, trigger, "started")
    let result: T
    try {
      result = await fn()
    } catch (error) {
      await recordTickEvent(connection, key, trigger, "failed", error)
      throw error
    }
    await recordTickEvent(connection, key, trigger, "completed")
    return result
  } finally {
    clearInterval(timer)
    await renewal
    // A failed release must not mask the tick's own outcome: the lease
    // simply runs out.
    await connection`
      update fleet_lease
      set expires_at = now()
      where name = ${name}
        and holder = ${holder}
    `.catch((error: unknown) => {
      log.warn("leases.release_failed", { key, error })
    })
  }
}
