import "server-only"

import type { ReservedSql } from "postgres"

import { getDatabase } from "@/lib/server/db"
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
] as const

export type LeaseKey = (typeof LEASE_KEYS)[number]

/**
 * `ops_heartbeat.name` for every tick whose lease a route actually takes, in
 * the order the health route reports them.
 *
 * `naba:sweep` is deliberately absent. The key exists so
 * `app/api/sync/sweep/route.ts` can adopt it -- it is the one cron route with
 * no advisory lock, and the scheduler now drives it daily -- but until that
 * handler is wrapped nothing stamps the row, and reporting a tick that can
 * never be stamped would be a permanent false alarm. Move it here in the same
 * change that wraps the route.
 */
export const SCHEDULER_TICK_NAMES: readonly string[] = LEASE_KEYS.filter(
  (key) => key !== "naba:sweep"
).map((key) => key.slice("naba:".length))

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
async function recordTickHeartbeat(connection: ReservedSql, key: LeaseKey) {
  try {
    // Platform-level write: ops_heartbeat is not tenant-scoped (0009), so it
    // is written outside withTenant, on the connection already reserved for
    // the lease.
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
  const connection = await getDatabase().reserve()
  let acquired = false
  try {
    const [lock] = await connection<{ acquired: boolean }[]>`
      select pg_try_advisory_lock(hashtext(${key})) as acquired
    `
    acquired = lock.acquired
    if (!acquired) return { skipped: true }
    const result = await fn()
    await recordTickHeartbeat(connection, key)
    return result
  } finally {
    try {
      if (acquired) {
        await connection`
          select pg_advisory_unlock(hashtext(${key}))
        `
      }
    } finally {
      connection.release()
    }
  }
}
