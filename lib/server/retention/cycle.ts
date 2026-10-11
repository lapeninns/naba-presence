import "server-only"

import type { Sql } from "postgres"

import { getDatabase } from "@/lib/server/db"
import { recordTickCycleCompleted } from "@/lib/server/leases"
import { log } from "@/lib/server/logger"
import type { TickFinding } from "@/lib/server/ops-liveness"
import {
  purgeEndedAbuseBuckets,
  purgeOrganisation,
  requireRetentionEnabled,
  retentionDeadline,
  retentionErrorCode,
  type OrganisationPurgeCounts,
  type OrganisationPurgeInput,
  type RetentionFailure,
} from "@/lib/server/retention/purge"

/**
 * The retention cycle (plan P04-1, migration 0097).
 *
 * A dispatcher fires every five minutes (vercel.json, scripts/scheduler.mjs)
 * under the `naba:retention` lease. Each fire either resumes the cycle that is
 * still running or, at or after 03:00 UTC, opens the day's cycle, then works
 * through it until its time budget runs out:
 *
 *   1. organisations already copied into the cycle and still pending;
 *   2. otherwise the next page of `organisation_job_route`, copied in from
 *      the persisted enumeration cursor;
 *   3. once enumeration has ended, organisations that failed on an EARLIER
 *      fire and have attempts left, so a failing tenant is retried a few
 *      times without ever being retried ahead of an organisation that has
 *      not had its first run.
 *
 * The cycle completes, and reports itself to the tick ledger through
 * `recordTickCycleCompleted`, when enumeration has ended and every
 * organisation in it has succeeded or used up its attempts. A second fire on
 * the same day finds the day's cycle completed and does nothing. A completed
 * cycle that left organisations failed raises its own operator alert
 * (retentionCycleFailureFinding), since completion alone clears the overdue
 * check.
 *
 * Progress is platform-level state, read and written outside withTenant; the
 * purge of each organisation runs in its own tenant transaction.
 */

/** No cycle opens before this hour (UTC); a running cycle resumes at any hour. */
export const RETENTION_CYCLE_START_HOUR_UTC = 3

/**
 * Runs an organisation may start within one cycle. Counted before each run,
 * so a fire killed in the middle of an organisation (maxDuration runs no
 * catch block) still uses one up, and an organisation that kills every fire
 * cannot hold the cycle open for ever.
 */
export const RETENTION_ORG_MAX_ATTEMPTS = 3

/** Completed cycles kept for reporting before the dispatcher prunes them. */
export const RETENTION_CYCLE_KEEP_DAYS = 35

/** Organisations copied into the cycle per enumeration read. */
export const RETENTION_ENUMERATION_PAGE = 100

/**
 * The UTC date of the cycle a fire at `now` may open, or null before 03:00
 * UTC, when no new cycle opens.
 */
export function retentionCycleDate(now: Date): string | null {
  if (now.getUTCHours() < RETENTION_CYCLE_START_HOUR_UTC) return null
  return now.toISOString().slice(0, 10)
}

export type RetentionCycle = {
  id: string
  cycleDate: string
  enumerationCursor: string | null
  enumerationCompletedAt: Date | null
  enumerated: number
  succeeded: number
  failed: number
  status: "running" | "completed"
  completedAt: Date | null
}

function cycleColumns(database: Sql) {
  return database`
    id::text as id,
    to_char(cycle_date, 'YYYY-MM-DD') as "cycleDate",
    enumeration_cursor::text as "enumerationCursor",
    enumeration_completed_at as "enumerationCompletedAt",
    enumerated,
    succeeded,
    failed,
    status,
    completed_at as "completedAt"
  `
}

async function readCycle(cycleId: string): Promise<RetentionCycle> {
  const database = getDatabase()
  const [cycle] = await database<RetentionCycle[]>`
    select ${cycleColumns(database)}
    from retention_cycle
    where id = ${cycleId}
  `
  if (!cycle) throw new Error(`retention cycle ${cycleId} not found`)
  return cycle
}

/**
 * The cycle this fire works on: the oldest one still running, whatever the
 * hour, or else the day's cycle if it is at or after 03:00 UTC and the day
 * has none yet. Null when there is nothing to do: before 03:00 with no cycle
 * running, or after the day's cycle has completed.
 *
 * Opening a cycle prunes completed cycles past RETENTION_CYCLE_KEEP_DAYS.
 */
export async function openOrResumeCycle(
  now: Date
): Promise<{ cycle: RetentionCycle; opened: boolean } | null> {
  const database = getDatabase()
  const [running] = await database<RetentionCycle[]>`
    select ${cycleColumns(database)}
    from retention_cycle
    where status = 'running'
    order by cycle_date
    limit 1
  `
  if (running) return { cycle: running, opened: false }
  const cycleDate = retentionCycleDate(now)
  if (!cycleDate) return null
  const [opened] = await database<RetentionCycle[]>`
    insert into retention_cycle (cycle_date)
    values (${cycleDate}::date)
    on conflict (cycle_date) do nothing
    returning ${cycleColumns(database)}
  `
  if (!opened) return null
  await database`
    delete from retention_cycle
    where status = 'completed'
      and cycle_date < ${cycleDate}::date - ${RETENTION_CYCLE_KEEP_DAYS}::int
  `
  return { cycle: opened, opened: true }
}

/**
 * The next organisations to retain in the cycle, in organisation order, or
 * an empty list when this fire has nothing left to do (see the module
 * comment for the order). `exclude` holds the organisations this fire has
 * already started, so a failure is retried on a later fire, never in a loop
 * inside this one.
 *
 * Organisations left pending with no attempts left -- every run of theirs
 * was killed -- are settled failed (`attempts_exhausted`) first.
 */
export async function nextOrganisations(
  cycleId: string,
  {
    limit = RETENTION_ENUMERATION_PAGE,
    exclude = [],
  }: { limit?: number; exclude?: readonly string[] } = {}
): Promise<string[]> {
  const database = getDatabase()
  const excluded = [...exclude]
  await database`
    with exhausted as (
      update retention_cycle_org
      set status = 'failed',
        last_error_code = 'attempts_exhausted',
        finished_at = now()
      where cycle_id = ${cycleId}
        and status = 'pending'
        and attempts >= ${RETENTION_ORG_MAX_ATTEMPTS}
      returning 1
    )
    update retention_cycle
    set failed = failed + (select count(*)::int from exhausted)
    where id = ${cycleId}
      and exists (select 1 from exhausted)
  `
  const pending = async () =>
    (
      await database<{ id: string }[]>`
        select organisation_id::text as id
        from retention_cycle_org
        where cycle_id = ${cycleId}
          and status = 'pending'
          and attempts < ${RETENTION_ORG_MAX_ATTEMPTS}
          and organisation_id <> all(${excluded}::uuid[])
        order by organisation_id
        limit ${limit}
      `
    ).map((row) => row.id)

  const waiting = await pending()
  if (waiting.length) return waiting

  let cycle = await readCycle(cycleId)
  while (!cycle.enumerationCompletedAt) {
    cycle = await enumerateNextPage(cycle, limit)
    const copied = await pending()
    if (copied.length) return copied
  }

  return (
    await database<{ id: string }[]>`
      select organisation_id::text as id
      from retention_cycle_org
      where cycle_id = ${cycleId}
        and status = 'failed'
        and attempts < ${RETENTION_ORG_MAX_ATTEMPTS}
        and organisation_id <> all(${excluded}::uuid[])
      order by organisation_id
      limit ${limit}
    `
  ).map((row) => row.id)
}

/**
 * Copies the next page of the fleet into the cycle as pending and moves the
 * persisted enumeration cursor past it. A page shorter than `limit` ends the
 * enumeration. Cross-tenant by design: organisation_job_route is read outside
 * withTenant, as every fleet walk does.
 */
async function enumerateNextPage(
  cycle: RetentionCycle,
  limit: number
): Promise<RetentionCycle> {
  const database = getDatabase()
  const [updated] = await database<RetentionCycle[]>`
    with page as (
      select organisation_id
      from organisation_job_route
      where ${cycle.enumerationCursor}::uuid is null
         or organisation_id > ${cycle.enumerationCursor}::uuid
      order by organisation_id
      limit ${limit}
    ),
    copied as (
      insert into retention_cycle_org (cycle_id, organisation_id)
      select ${cycle.id}, organisation_id from page
      on conflict do nothing
      returning 1
    )
    update retention_cycle
    set enumeration_cursor = coalesce(
          (select organisation_id from page order by organisation_id desc limit 1),
          enumeration_cursor
        ),
        enumerated = enumerated + (select count(*)::int from copied),
        enumeration_completed_at = case
          when (select count(*) from page) < ${limit} then now()
          else null
        end
    where id = ${cycle.id}
    returning ${cycleColumns(database)}
  `
  return updated
}

/** Left on a claimed organisation until its run settles. */
export const RETENTION_ATTEMPT_INTERRUPTED = "attempt_interrupted"

/**
 * Counts one run against the organisation before it starts. False when the
 * organisation has already succeeded or has no attempts left, in which case
 * it must not run.
 *
 * The run's error code reads `attempt_interrupted` until recordOrgOutcome
 * settles it, so a run the platform killed (maxDuration runs no catch block)
 * shows as killed rather than keeping an earlier run's error.
 */
export async function claimOrganisation(
  cycleId: string,
  organisationId: string
): Promise<boolean> {
  const rows = await getDatabase()`
    update retention_cycle_org
    set attempts = attempts + 1,
      last_error_code = ${RETENTION_ATTEMPT_INTERRUPTED}
    where cycle_id = ${cycleId}
      and organisation_id = ${organisationId}
      and status <> 'succeeded'
      and attempts < ${RETENTION_ORG_MAX_ATTEMPTS}
    returning 1
  `
  return rows.length > 0
}

export type OrganisationOutcome =
  { ok: true } | { ok: false; errorCode: string }

/**
 * Settles one organisation's run and keeps the cycle's counts in step: a
 * first failure counts as failed, a retry that then succeeds moves it from
 * failed to succeeded, and a repeated failure is counted once.
 */
export async function recordOrgOutcome(
  cycleId: string,
  organisationId: string,
  outcome: OrganisationOutcome
) {
  const status = outcome.ok ? "succeeded" : "failed"
  const errorCode = outcome.ok ? null : outcome.errorCode.slice(0, 64)
  await getDatabase()`
    with previous as (
      select status
      from retention_cycle_org
      where cycle_id = ${cycleId}
        and organisation_id = ${organisationId}
    ),
    settled as (
      update retention_cycle_org
      set status = ${status},
        last_error_code = ${errorCode},
        finished_at = now()
      where cycle_id = ${cycleId}
        and organisation_id = ${organisationId}
        and status <> 'succeeded'
      returning 1
    )
    update retention_cycle
    set succeeded = succeeded + case
          when ${status} = 'succeeded' then 1 else 0
        end,
        failed = failed + case
          when ${status} = 'failed'
            and (select status from previous) = 'pending' then 1
          when ${status} = 'succeeded'
            and (select status from previous) = 'failed' then -1
          else 0
        end
    where id = ${cycleId}
      and exists (select 1 from settled)
  `
}

/**
 * Completes the cycle when enumeration has ended and no organisation is left
 * to run: every one has succeeded or used up its attempts. True only for the
 * call that completed it.
 */
export async function completeCycle(cycleId: string): Promise<boolean> {
  const rows = await getDatabase()`
    update retention_cycle c
    set status = 'completed', completed_at = now()
    where c.id = ${cycleId}
      and c.status = 'running'
      and c.enumeration_completed_at is not null
      and not exists (
        select 1
        from retention_cycle_org o
        where o.cycle_id = c.id
          and o.status <> 'succeeded'
          and o.attempts < ${RETENTION_ORG_MAX_ATTEMPTS}
      )
    returning 1
  `
  return rows.length > 0
}

/** Organisations named in a tick_cycle_failures alert. */
export const RETENTION_FAILURE_ALERT_LIMIT = 10

/**
 * The operator finding for organisations the latest completed cycle could
 * not retain, or null when it retained every one (or none has completed).
 *
 * Completing a cycle stamps `last_cycle_completed_at` whether or not every
 * organisation succeeded, so tick_cycle_overdue cannot see a tenant whose
 * purge fails every day. This reads the failed rows themselves rather than
 * the cycle's `failed` count, which keeps counting a tenant deleted since.
 * `repeated` counts organisations that also failed in the completed cycle
 * before it. The finding stays open while today's cycle runs and resolves
 * once a later cycle completes clean.
 *
 * Platform-level read, outside withTenant: ids and codes only.
 */
export async function retentionCycleFailureFinding(): Promise<TickFinding | null> {
  const database = getDatabase()
  const [latest] = await database<
    {
      id: string
      cycleDate: string
      completedAt: Date
      enumerated: number
      succeeded: number
      previousId: string | null
    }[]
  >`
    select
      c.id::text as id,
      to_char(c.cycle_date, 'YYYY-MM-DD') as "cycleDate",
      c.completed_at as "completedAt",
      c.enumerated,
      c.succeeded,
      (
        select p.id::text
        from retention_cycle p
        where p.status = 'completed'
          and p.cycle_date < c.cycle_date
        order by p.cycle_date desc
        limit 1
      ) as "previousId"
    from retention_cycle c
    where c.status = 'completed'
    order by c.cycle_date desc
    limit 1
  `
  if (!latest) return null
  const failed = await database<
    {
      organisationId: string
      attempts: number
      lastErrorCode: string | null
      failedPreviousCycle: boolean
    }[]
  >`
    select
      o.organisation_id::text as "organisationId",
      o.attempts,
      o.last_error_code as "lastErrorCode",
      exists (
        select 1
        from retention_cycle_org p
        where p.cycle_id = ${latest.previousId}::uuid
          and p.organisation_id = o.organisation_id
          and p.status = 'failed'
      ) as "failedPreviousCycle"
    from retention_cycle_org o
    where o.cycle_id = ${latest.id}
      and o.status = 'failed'
    order by o.organisation_id
  `
  if (!failed.length) return null
  return {
    kind: "tick_cycle_failures",
    subject: "retention",
    details: {
      cycleId: latest.id,
      cycleDate: latest.cycleDate,
      completedAt: latest.completedAt.toISOString(),
      enumerated: latest.enumerated,
      succeeded: latest.succeeded,
      failed: failed.length,
      repeated: failed.filter((row) => row.failedPreviousCycle).length,
      organisations: failed.slice(0, RETENTION_FAILURE_ALERT_LIMIT),
    },
  }
}

export type RetentionCycleInput = {
  requestId: string
  clientRequestId: string | null
  /** The fire's clock, for the 03:00 UTC gate. Injected by tests. */
  now?: Date
  /** Organisations copied into the cycle per enumeration read. */
  pageSize?: number
  /** The per-organisation purge. Injected by tests to make one fail. */
  purge?: (input: OrganisationPurgeInput) => Promise<OrganisationPurgeCounts>
}

/**
 * One dispatcher fire. Call it under the `naba:retention` lease: the cycle's
 * progress assumes a single writer.
 *
 * The pause table and the retention switches are read first, outside every
 * tenant transaction; a paused scope throws `retention_paused` (503) before
 * any cycle opens.
 */
export async function runRetentionCycle({
  requestId,
  clientRequestId,
  now = new Date(),
  pageSize = RETENTION_ENUMERATION_PAGE,
  purge = purgeOrganisation,
}: RetentionCycleInput) {
  const { deletesEnabled } = await requireRetentionEnabled()
  const deadline = retentionDeadline()
  const current = await openOrResumeCycle(now)
  if (!current) {
    return {
      cycle: null,
      opened: false,
      completed: false,
      organisations: [],
      failures: [] as RetentionFailure[],
      abuseRateBuckets: null,
    }
  }
  const { cycle, opened } = current
  // Ended abuse-limit windows are platform-level, so they are purged once per
  // cycle, when it opens.
  const abuseRateBuckets = opened
    ? await purgeEndedAbuseBuckets(requestId)
    : null

  const results: Array<Record<string, string | number>> = []
  const failures: RetentionFailure[] = []
  const started = new Set<string>()
  let processed = 0
  let budgetExhausted = false
  walk: for (;;) {
    const batch = await nextOrganisations(cycle.id, {
      limit: pageSize,
      exclude: [...started],
    })
    if (!batch.length) break
    for (const organisationId of batch) {
      if (processed > 0 && Date.now() >= deadline) {
        budgetExhausted = true
        break walk
      }
      started.add(organisationId)
      if (!(await claimOrganisation(cycle.id, organisationId))) continue
      processed += 1
      let outcome: OrganisationOutcome
      try {
        const purged = await purge({
          organisationId,
          requestId,
          clientRequestId,
          deletesEnabled,
        })
        results.push({ organisationId, ...purged })
        outcome = { ok: true }
      } catch (error) {
        // One tenant's failure must not hold up the rest of the cycle: it is
        // recorded, retried on a later fire while it has attempts left, and
        // the walk goes on.
        const errorCode = retentionErrorCode(error)
        failures.push({ organisationId, errorCode })
        log.error("retention.organisation_failed", {
          requestId,
          cycleId: cycle.id,
          organisationId,
          errorCode,
          error,
        })
        outcome = { ok: false, errorCode }
      }
      await recordOrgOutcome(cycle.id, organisationId, outcome)
    }
  }

  const completed = budgetExhausted ? false : await completeCycle(cycle.id)
  const settled = await readCycle(cycle.id)
  if (completed) {
    await recordTickCycleCompleted("naba:retention")
    log.info("retention.cycle_completed", {
      requestId,
      cycleId: settled.id,
      cycleDate: settled.cycleDate,
      enumerated: settled.enumerated,
      succeeded: settled.succeeded,
      failed: settled.failed,
    })
  }
  return {
    cycle: {
      id: settled.id,
      cycleDate: settled.cycleDate,
      status: settled.status,
      enumerated: settled.enumerated,
      succeeded: settled.succeeded,
      failed: settled.failed,
      enumerationCompleted: settled.enumerationCompletedAt !== null,
    },
    opened,
    completed,
    organisations: results,
    failures,
    abuseRateBuckets,
  }
}
