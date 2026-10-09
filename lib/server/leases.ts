import "server-only"

import type { Sql } from "postgres"

import { withSessionConnection } from "@/lib/server/db"
import { log } from "@/lib/server/logger"

/**
 * One advisory lease per scheduled tick. The suffix after `naba:` is also the
 * `ops_heartbeat` row the tick stamps on a completed run, so the lock
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
 * Records that this tick reached the web process and finished. Written only
 * on a run that held the lease and returned: a lock skip proves nothing about
 * the tick, and a throw means the walk did not complete, so "no heartbeat
 * since" is exactly the staleness the health route alerts on.
 *
 * It means "a walk under this lease completed", not "the cron completed" -- a
 * session-driven refresh takes the same fleet lease. Data freshness is what
 * `reconcileStalenessSeconds` covers; this is liveness.
 */
async function recordTickHeartbeat(connection: Sql, key: LeaseKey) {
  try {
    // Platform-level write: ops_heartbeat is not tenant-scoped (0009), so it
    // is written outside withTenant, on the connection already holding the
    // lease.
    await connection`
      insert into ops_heartbeat (name, beat_at)
      values (${tickName(key)}, now())
      on conflict (name) do update
      set beat_at = excluded.beat_at
    `
  } catch (error) {
    // Liveness bookkeeping must never fail the tick that just succeeded; a
    // missed stamp reads as staleness, which is the safe direction.
    log.warn("leases.heartbeat_failed", { key, error })
  }
}

export async function withAdvisoryLock<T>(
  key: LeaseKey,
  fn: () => Promise<T>
): Promise<T | { skipped: true }> {
  // The lock outlives many transactions, so it needs a session connection.
  // Closing that connection also releases the lock (the pooler resets the
  // backend with DISCARD ALL), so a failed unlock must not mask the tick's
  // own outcome.
  return withSessionConnection(async (connection) => {
    const [lock] = await connection<{ acquired: boolean }[]>`
      select pg_try_advisory_lock(hashtext(${key})) as acquired
    `
    if (!lock.acquired) return { skipped: true }
    try {
      const result = await fn()
      await recordTickHeartbeat(connection, key)
      return result
    } finally {
      await connection`
        select pg_advisory_unlock(hashtext(${key}))
      `.catch((error: unknown) => {
        log.warn("leases.unlock_failed", { key, error })
      })
    }
  })
}
