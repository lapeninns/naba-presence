import "server-only"

import { getDatabase } from "@/lib/server/db"
import { log } from "@/lib/server/logger"

/** The cursor-walked ticks whose GET shims resume from `cron_cursor`. */
export type CronWalk = "reconcile" | "presence-resources" | "performance" | "keywords"

/**
 * Fires that may start from the same stored cursor without finishing before
 * the walk gives up on it and restarts at the head.
 */
const MAX_UNFINISHED_ATTEMPTS = 3

/**
 * Run one page of a cron tenant walk, resuming where the previous fire
 * stopped.
 *
 * Vercel Cron fires a bare GET with no memory, so before this every tick
 * started at the head of the tenant order: a fleet larger than one page (or a
 * page that ran out of time budget) never reached its tail. The page's
 * `nextCursor` is stored in `cron_cursor` and handed to the next fire; a null
 * cursor means the walk finished and the next fire starts again at the head.
 *
 * Restarting at the head used to be what kept a page that fails every time
 * from starving the organisations after it. That property is kept: a fire
 * that throws resets the walk to the head, and so does a cursor that
 * `MAX_UNFINISHED_ATTEMPTS` fires in a row started from without finishing
 * (the platform killing a request at `maxDuration` runs no catch block).
 *
 * An explicit `organisationCursor` in the query wins and is not stored, so a
 * hand-run page cannot move the scheduled walk. A lock skip leaves the stored
 * cursor alone: the page did not run.
 */
export async function followCronCursor<
  R extends { nextCursor: string | null; skipped?: boolean },
>(
  walk: CronWalk,
  input: Record<string, unknown>,
  runPage: (input: Record<string, unknown>) => Promise<R>
): Promise<R> {
  if (input.organisationCursor !== undefined) return runPage(input)
  const database = getDatabase()
  // Platform-level, like ops_heartbeat: the walk spans tenants, so this is
  // read and written outside withTenant.
  const [claimed] = await database<{ cursor: string | null; attempts: number }[]>`
    insert into cron_cursor (name, attempts, updated_at)
    values (${walk}, 1, now())
    on conflict (name) do update
    set attempts = cron_cursor.attempts + 1
    returning organisation_cursor::text as cursor, attempts
  `
  let cursor = claimed?.cursor ?? null
  if (cursor && (claimed?.attempts ?? 0) > MAX_UNFINISHED_ATTEMPTS) {
    log.warn("cron.cursor_reset", {
      walk,
      cursor,
      attempts: claimed?.attempts,
      reason: "unfinished_attempts",
    })
    cursor = null
  }
  let result: R
  try {
    result = await runPage(cursor ? { ...input, organisationCursor: cursor } : input)
  } catch (error) {
    await storeCursor(walk, null)
    log.warn("cron.cursor_reset", { walk, cursor, reason: "page_failed" })
    throw error
  }
  if (result.skipped === true) {
    // Another fire holds the walk; this one did not start from the cursor.
    await database`
      update cron_cursor
      set attempts = greatest(attempts - 1, 0)
      where name = ${walk}
    `.catch((error) => log.warn("cron.cursor_store_failed", { walk, error }))
    return result
  }
  await storeCursor(walk, result.nextCursor)
  return result
}

async function storeCursor(walk: CronWalk, cursor: string | null) {
  try {
    await getDatabase()`
      update cron_cursor
      set organisation_cursor = ${cursor}, attempts = 0, updated_at = now()
      where name = ${walk}
    `
  } catch (error) {
    // The page already ran. Losing the cursor costs the next fire a restart
    // at the head, which is what happened on every fire before this.
    log.warn("cron.cursor_store_failed", { walk, error })
  }
}
