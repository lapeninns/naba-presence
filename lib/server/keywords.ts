import "server-only"

import { metrics, trace } from "@opentelemetry/api"

import { retryDelayMs } from "@/lib/domain/retry"
import { writeAudit } from "@/lib/server/audit"
import { getDatabase, withTenant } from "@/lib/server/db"
import { gbpIngestionEnabled, getServerEnv } from "@/lib/server/env"
import {
  connectionAccessToken,
  googleSearchKeywordImpressions,
  type GoogleSearchKeywordPoint,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"

const keywordTracer = trace.getTracer("nabapresence.keywords")
const keywordMeter = metrics.getMeter("nabapresence.keywords")
const keywordSyncCount = keywordMeter.createCounter(
  "nabapresence.keyword_sync.count"
)

const INITIAL_MONTHS = 18
const RESTATEMENT_MONTHS = 2
/**
 * Consecutive failures before a checkpoint is retired, mirroring the webhook
 * ceiling in 0029 (`retry_count >= 5`). `attempt_count` is reset on success,
 * so this counts consecutive failures rather than lifetime attempts.
 */
const MAX_CONSECUTIVE_FAILURES = 5

type KeywordLocation = {
  externalLocationId: string
  connectionId: string
  googleLocationName: string
  checkpointId: string
  lastKeywordMonth: string | null
  attemptCount: number
}

export type KeywordSyncOutcome = {
  externalLocationId: string
  status: "succeeded" | "failed"
  months: number
  upserted: number
  freshThrough: string | null
  errorCode?: string
}

function firstOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function addMonths(date: Date, months: number) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)
  )
}

function monthText(date: Date) {
  return date.toISOString().slice(0, 7)
}

export function keywordMonths(
  now: Date,
  lastKeywordMonth: string | null
): string[] {
  const current = firstOfMonth(now)
  const floor = addMonths(current, -(INITIAL_MONTHS - 1))
  const restatementStart = addMonths(current, -(RESTATEMENT_MONTHS - 1))
  // The watermark's value decides where the walk starts, not merely whether
  // it is set. A pause longer than the restatement overlap would otherwise
  // leave months that nothing ever requests again: there is no keyword
  // backfill path, and the read path just sums whatever rows survive.
  const resumeFrom = lastKeywordMonth
    ? new Date(`${lastKeywordMonth.slice(0, 7)}-01T00:00:00Z`)
    : floor
  const start = new Date(
    Math.max(
      floor.getTime(),
      Math.min(restatementStart.getTime(), resumeFrom.getTime())
    )
  )
  const months: string[] = []
  for (
    let cursor = start;
    cursor.getTime() <= current.getTime();
    cursor = addMonths(cursor, 1)
  ) {
    months.push(monthText(cursor))
  }
  return months
}

/**
 * Creates the missing keyword checkpoints and revives cancelled ones.
 *
 * Unlinking a location (or disconnecting its connection) cancels every
 * checkpoint of that external location, but only the `performance` and
 * `backfill` checkpoints are reset when it is relinked — a cancelled
 * `keywords` row is claimable by nothing, so relinking used to kill keyword
 * sync for the life of the external location. `last_keyword_month` is
 * deliberately kept: `keywordMonths` derives the walk from it and reaches
 * back to the 18-month floor, so the unlinked period is refetched.
 */
export async function ensureKeywordCheckpoints(organisationId: string) {
  return withTenant(organisationId, async (sql) => {
    const rows = await sql`
      insert into sync_checkpoint (
        organisation_id,
        external_location_id,
        sync_type,
        status,
        next_attempt_at
      )
      select
        ${organisationId},
        ll.external_location_id,
        'keywords',
        'pending',
        now()
      from location_link ll
      join external_location el on el.id = ll.external_location_id
      join google_connection gc on gc.id = el.google_connection_id
      where ll.is_active = true
        and gc.status = 'active'
      on conflict (organisation_id, external_location_id, sync_type)
      do update set
        status = 'pending',
        next_attempt_at = now(),
        attempt_count = 0,
        dead_lettered_at = null,
        last_error_code = null,
        finished_at = null
      where sync_checkpoint.status = 'cancelled'
         or sync_checkpoint.dead_lettered_at is not null
      returning id
    `
    return rows.length
  })
}

async function claimDueKeywordLocation(
  organisationId: string,
  externalLocationId?: string
): Promise<KeywordLocation | null> {
  return withTenant(organisationId, async (sql) => {
    const [row] = await sql<KeywordLocation[]>`
      with candidate as (
        select sc.id
        from sync_checkpoint sc
        join location_link ll
          on ll.external_location_id = sc.external_location_id
         and ll.is_active = true
        where sc.sync_type = 'keywords'
          and sc.status in ('pending', 'failed', 'succeeded')
          and sc.dead_lettered_at is null
          and coalesce(sc.next_attempt_at, now()) <= now()
          ${externalLocationId ? sql`and sc.external_location_id = ${externalLocationId}` : sql``}
        order by sc.next_attempt_at nulls first, sc.id
        limit 1
        for update of sc skip locked
      )
      update sync_checkpoint sc
      set
        status = 'running',
        attempt_count = sc.attempt_count + 1,
        started_at = now(),
        finished_at = null,
        last_error_code = null,
        next_attempt_at = null
      from candidate, external_location el
      where sc.id = candidate.id
        and el.id = sc.external_location_id
      returning
        sc.external_location_id::text as "externalLocationId",
        el.google_connection_id::text as "connectionId",
        el.google_location_name as "googleLocationName",
        sc.id::text as "checkpointId",
        sc.last_keyword_month::text as "lastKeywordMonth",
        sc.attempt_count as "attemptCount"
    `
    return row ?? null
  })
}

function pointScore(point: GoogleSearchKeywordPoint) {
  return point.impressions ?? point.threshold ?? 0
}

/**
 * Restates one month, committed in its own transaction as that month
 * returns, so a month Google refuses later in the walk cannot discard the
 * months already fetched.
 */
async function persistKeywordMonth(
  organisationId: string,
  location: KeywordLocation,
  month: string,
  points: GoogleSearchKeywordPoint[]
) {
  return withTenant(organisationId, async (sql) => {
    await sql`
      delete from performance_search_keyword_monthly
      where external_location_id = ${location.externalLocationId}
        and metric_month = ${`${month}-01`}::date
    `
    const ranked = [...points].sort(
      (left, right) =>
        pointScore(right) - pointScore(left) ||
        left.keyword.localeCompare(right.keyword)
    )
    for (const [index, point] of ranked.entries()) {
      await sql`
        insert into performance_search_keyword_monthly (
          organisation_id,
          external_location_id,
          metric_month,
          keyword,
          impressions,
          threshold,
          rank,
          observed_at
        )
        values (
          ${organisationId},
          ${location.externalLocationId},
          ${`${month}-01`}::date,
          ${point.keyword},
          ${point.impressions},
          ${point.threshold},
          ${index + 1},
          now()
        )
      `
    }
    return ranked.length
  })
}

type KeywordWalk = {
  requestId: string
  months: number
  upserted: number
  freshThrough: string | null
  unrecognisedMonths: string[]
  dropped: number
}

async function settleKeywordCheckpoint(
  organisationId: string,
  location: KeywordLocation,
  walk: KeywordWalk
) {
  const monthDate = walk.freshThrough ? `${walk.freshThrough}-01` : null
  await withTenant(organisationId, async (sql) => {
    await sql`
      update sync_checkpoint
      set
        status = 'succeeded',
        last_keyword_month = greatest(last_keyword_month, ${monthDate}::date),
        attempt_count = 0,
        dead_lettered_at = null,
        -- From the slot this run was due in (0048), so a late tick does
        -- not push every later run back.
        next_attempt_at = next_scheduled_run(scheduled_for, interval '24 hours'),
        finished_at = now(),
        last_succeeded_at = now(),
        last_error_code = ${
          walk.unrecognisedMonths.length ? "keyword_months_unrecognised" : null
        }
      where id = ${location.checkpointId}
    `
    await writeAudit(sql, {
      organisationId,
      action: "performance.keywords.synced",
      subjectType: "external_location",
      subjectId: location.externalLocationId,
      requestId: `${walk.requestId}:${location.externalLocationId}`,
      metadata: {
        months: walk.months,
        upserted: walk.upserted,
        freshThrough: walk.freshThrough,
        unrecognisedMonths: walk.unrecognisedMonths,
        dropped: walk.dropped,
      },
    })
  })
}

function keywordErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String(error.code)
  }
  return "keyword_sync_failed"
}

async function failKeywordSync(
  organisationId: string,
  location: KeywordLocation,
  error: unknown,
  requestId: string,
  freshThrough: string | null
) {
  const errorCode = keywordErrorCode(error)
  const deadLettered = location.attemptCount >= MAX_CONSECUTIVE_FAILURES
  // retryDelayMs caps at its own `capMs`, so the range has to be passed in:
  // wrapping the default-capped call in Math.max(1h, Math.min(24h, …)) always
  // returned exactly one hour and made attemptCount inert.
  const delay = retryDelayMs(
    location.attemptCount,
    Math.random,
    3_600_000,
    86_400_000
  )
  // Months committed before the failing one stay committed, so the watermark
  // moves with them and the next attempt resumes at the month that failed
  // instead of re-walking the whole window into it.
  const monthDate = freshThrough ? `${freshThrough}-01` : null
  await withTenant(organisationId, async (sql) => {
    await sql`
      update sync_checkpoint
      set
        status = 'failed',
        last_error_code = ${errorCode},
        last_keyword_month = greatest(last_keyword_month, ${monthDate}::date),
        next_attempt_at = ${deadLettered ? null : new Date(Date.now() + delay)},
        dead_lettered_at = ${deadLettered ? new Date() : null},
        finished_at = now()
      where id = ${location.checkpointId}
    `
    // In the same transaction as the status write, so a checkpoint can never
    // be 'failed' without the row that outlives log retention.
    await writeAudit(sql, {
      organisationId,
      action: "performance.keywords.sync_failed",
      subjectType: "external_location",
      subjectId: location.externalLocationId,
      requestId: `${requestId}:${location.externalLocationId}`,
      metadata: {
        errorCode,
        attemptCount: location.attemptCount,
        deadLettered,
        freshThrough,
      },
    })
  })
  log.error("performance.keywords.sync_failed", {
    requestId,
    organisationId,
    externalLocationId: location.externalLocationId,
    errorCode,
    attemptCount: location.attemptCount,
    deadLettered,
    error,
  })
  return errorCode
}

export async function syncDueKeywords(
  organisationId: string,
  options: {
    requestId: string
    externalLocationId?: string
    maxLocations?: number
  }
): Promise<KeywordSyncOutcome[]> {
  // Ingestion boundary: GBP_KEYWORDS_ENABLED pauses provider reads and
  // checkpoint creation; stored keyword months stay readable.
  if (!gbpIngestionEnabled(getServerEnv(), "keywords")) {
    throw new ApiError(
      503,
      "sync_paused",
      "Search keyword ingestion is paused."
    )
  }
  await ensureKeywordCheckpoints(organisationId)
  const outcomes: KeywordSyncOutcome[] = []
  const maxLocations = Math.min(25, Math.max(1, options.maxLocations ?? 10))
  for (let index = 0; index < maxLocations; index += 1) {
    const location = await claimDueKeywordLocation(
      organisationId,
      options.externalLocationId
    )
    if (!location) break
    const outcome = await keywordTracer.startActiveSpan(
      "performance.keywords.location.sync",
      async (span) => {
        let persistedMonths = 0
        let upserted = 0
        let dropped = 0
        let freshThrough: string | null = null
        // The watermark may only advance over an unbroken run of persisted
        // months; a skipped month in the middle must stay inside the next
        // walk's window.
        let contiguous = true
        const unrecognisedMonths: string[] = []
        try {
          const accessToken = await connectionAccessToken(
            getDatabase(),
            organisationId,
            location.connectionId
          )
          const months = keywordMonths(new Date(), location.lastKeywordMonth)
          for (const month of months) {
            const page = await googleSearchKeywordImpressions(
              accessToken,
              { locationName: location.googleLocationName, month },
              { connectionKey: location.connectionId }
            )
            dropped += page.dropped
            if (!page.sawCountsArray) {
              // A 200 carrying no `searchKeywordsCounts` array is not an
              // empty month. Restating deletes the month before it inserts,
              // so treating an unrecognised body as empty would destroy real
              // history; leave the stored month alone and report it instead.
              unrecognisedMonths.push(month)
              contiguous = false
              continue
            }
            upserted += await persistKeywordMonth(
              organisationId,
              location,
              month,
              page.points
            )
            persistedMonths += 1
            if (contiguous) freshThrough = month
          }
          if (dropped > 0) {
            log.warn("performance.keywords.entries_dropped", {
              requestId: options.requestId,
              organisationId,
              externalLocationId: location.externalLocationId,
              dropped,
            })
          }
          await settleKeywordCheckpoint(organisationId, location, {
            requestId: options.requestId,
            months: persistedMonths,
            upserted,
            freshThrough,
            unrecognisedMonths,
            dropped,
          })
          keywordSyncCount.add(1, { outcome: "succeeded" })
          return {
            externalLocationId: location.externalLocationId,
            status: "succeeded" as const,
            months: persistedMonths,
            upserted,
            freshThrough,
          }
        } catch (error) {
          // failKeywordSync opens its own transaction, so a database error
          // here would otherwise escape this catch and reject the whole tick.
          // The lease reaper recovers the 'running' row 15 minutes on.
          const errorCode = await failKeywordSync(
            organisationId,
            location,
            error,
            options.requestId,
            freshThrough
          ).catch((settleError) => {
            log.error("performance.keywords.settle_failed", {
              requestId: options.requestId,
              organisationId,
              externalLocationId: location.externalLocationId,
              error: settleError,
            })
            return "settle_failed"
          })
          keywordSyncCount.add(1, { outcome: "failed", errorCode })
          return {
            externalLocationId: location.externalLocationId,
            status: "failed" as const,
            months: persistedMonths,
            upserted,
            freshThrough,
            errorCode,
          }
        } finally {
          span.end()
        }
      }
    )
    outcomes.push(outcome)
    if (options.externalLocationId) break
  }
  return outcomes
}
