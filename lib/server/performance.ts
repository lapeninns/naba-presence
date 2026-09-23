import "server-only"

import { metrics, trace } from "@opentelemetry/api"

import {
  GOOGLE_PERFORMANCE_METRICS,
  type GooglePerformanceMetric,
} from "@/lib/domain/google-contract"
import { retryDelayMs } from "@/lib/domain/retry"
import { writeAudit } from "@/lib/server/audit"
import { getDatabase, withTenant } from "@/lib/server/db"
import { gbpIngestionEnabled, getServerEnv } from "@/lib/server/env"
import {
  connectionAccessToken,
  googlePerformanceMetrics,
  type GooglePerformancePoint,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"

const performanceTracer = trace.getTracer("nabapresence.performance")
const performanceMeter = metrics.getMeter("nabapresence.performance")
const performanceSyncCount = performanceMeter.createCounter(
  "nabapresence.performance_sync.count"
)

const DAY_MS = 86_400_000
const RESTATEMENT_DAYS = 10
const METRIC_MONTHS = 18
/**
 * Consecutive failures before a checkpoint is retired, mirroring the webhook
 * ceiling in 0029 (`retry_count >= 5`). `attempt_count` is reset on success,
 * so this counts consecutive failures rather than lifetime attempts.
 */
const MAX_CONSECUTIVE_FAILURES = 5

export type PerformanceSyncOutcome = {
  externalLocationId: string
  status: "succeeded" | "failed"
  upserted: number
  freshThrough: string | null
  errorCode?: string
}

type PerformanceLocation = {
  externalLocationId: string
  connectionId: string
  googleLocationName: string
  checkpointId: string
  lastMetricDate: string | null
  attemptCount: number
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * The oldest day worth asking for: Google serves 18 months of daily metrics,
 * and that is also the longest range the presence report offers.
 */
function metricFloor(end: Date): Date {
  const targetMonth = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - METRIC_MONTHS, 1)
  )
  const lastDay = new Date(
    Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)
  ).getUTCDate()
  return new Date(
    Date.UTC(
      targetMonth.getUTCFullYear(),
      targetMonth.getUTCMonth(),
      Math.min(end.getUTCDate(), lastDay)
    )
  )
}

export function performanceDateWindow(
  now: Date,
  lastMetricDate: string | null
) {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
  const floor = metricFloor(end)
  const restatementStart = new Date(
    end.getTime() - (RESTATEMENT_DAYS - 1) * DAY_MS
  )
  // The watermark's value decides how far back to reach, not merely whether
  // it is set: a location paused or failing for longer than the restatement
  // window must re-request every day it missed, because nothing else ever
  // revisits a day and the read path renders a hole as lower traffic rather
  // than as missing data.
  const resumeFrom = lastMetricDate
    ? new Date(`${lastMetricDate}T00:00:00Z`)
    : floor
  const start = new Date(
    Math.max(
      floor.getTime(),
      Math.min(restatementStart.getTime(), resumeFrom.getTime())
    )
  )
  return { startDate: dateOnly(start), endDate: dateOnly(end) }
}

export async function ensurePerformanceCheckpoints(organisationId: string) {
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
        'performance',
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
      -- Relinking a location is the operator's explicit "try again": without
      -- this, a checkpoint that was cancelled by an unlink or retired by the
      -- dead-letter ceiling has no path back to claimable, and the location's
      -- metrics stop forever.
      where sync_checkpoint.status = 'cancelled'
         or sync_checkpoint.dead_lettered_at is not null
      returning id
    `
    return rows.length
  })
}

async function claimDuePerformanceLocation(
  organisationId: string,
  externalLocationId?: string
): Promise<PerformanceLocation | null> {
  return withTenant(organisationId, async (sql) => {
    const [row] = await sql<PerformanceLocation[]>`
      with candidate as (
        select sc.id
        from sync_checkpoint sc
        join location_link ll
          on ll.external_location_id = sc.external_location_id
         and ll.is_active = true
        where sc.sync_type = 'performance'
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
        sc.last_metric_date::text as "lastMetricDate",
        sc.attempt_count as "attemptCount"
    `
    return row ?? null
  })
}

async function persistPerformancePoints(
  organisationId: string,
  location: PerformanceLocation,
  points: GooglePerformancePoint[],
  requestId: string
) {
  return withTenant(organisationId, async (sql) => {
    for (const point of points) {
      await sql`
        insert into performance_metric_daily (
          organisation_id,
          external_location_id,
          metric,
          metric_date,
          value
        )
        values (
          ${organisationId},
          ${location.externalLocationId},
          ${point.metric},
          ${point.date},
          ${point.value}
        )
        on conflict (
          organisation_id,
          external_location_id,
          metric,
          metric_date
        ) do update
        set value = excluded.value
      `
    }
    const freshThrough = points.reduce<string | null>(
      (latest, point) => (!latest || point.date > latest ? point.date : latest),
      null
    )
    await sql`
      update sync_checkpoint
      set
        status = 'succeeded',
        last_metric_date = greatest(last_metric_date, ${freshThrough}::date),
        attempt_count = 0,
        dead_lettered_at = null,
        next_attempt_at = now() + interval '6 hours',
        finished_at = now(),
        last_succeeded_at = now(),
        last_error_code = null
      where id = ${location.checkpointId}
    `
    await writeAudit(sql, {
      organisationId,
      action: "performance.synced",
      subjectType: "external_location",
      subjectId: location.externalLocationId,
      requestId: `${requestId}:${location.externalLocationId}`,
      metadata: { upserted: points.length, freshThrough },
    })
    return freshThrough
  })
}

function performanceErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String(error.code)
  }
  return "performance_sync_failed"
}

async function failPerformanceSync(
  organisationId: string,
  location: PerformanceLocation,
  error: unknown,
  requestId: string
) {
  const errorCode = performanceErrorCode(error)
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
  await withTenant(organisationId, async (sql) => {
    await sql`
      update sync_checkpoint
      set
        status = 'failed',
        last_error_code = ${errorCode},
        next_attempt_at = ${deadLettered ? null : new Date(Date.now() + delay)},
        dead_lettered_at = ${deadLettered ? new Date() : null},
        finished_at = now()
      where id = ${location.checkpointId}
    `
    // In the same transaction as the status write, so a checkpoint can never
    // be 'failed' without the row that outlives log retention.
    await writeAudit(sql, {
      organisationId,
      action: "performance.sync_failed",
      subjectType: "external_location",
      subjectId: location.externalLocationId,
      requestId: `${requestId}:${location.externalLocationId}`,
      metadata: {
        errorCode,
        attemptCount: location.attemptCount,
        deadLettered,
      },
    })
  })
  log.error("performance.sync_failed", {
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

export async function syncDuePerformance(
  organisationId: string,
  options: {
    requestId: string
    externalLocationId?: string
    maxLocations?: number
  }
): Promise<PerformanceSyncOutcome[]> {
  // Ingestion boundary: GBP_PERFORMANCE_ENABLED pauses provider reads and
  // checkpoint creation; stored metrics stay readable.
  if (!gbpIngestionEnabled(getServerEnv(), "performance")) {
    throw new ApiError(503, "sync_paused", "Performance ingestion is paused.")
  }
  await ensurePerformanceCheckpoints(organisationId)
  const outcomes: PerformanceSyncOutcome[] = []
  const maxLocations = Math.min(50, Math.max(1, options.maxLocations ?? 25))
  for (let index = 0; index < maxLocations; index += 1) {
    const location = await claimDuePerformanceLocation(
      organisationId,
      options.externalLocationId
    )
    if (!location) break
    const outcome = await performanceTracer.startActiveSpan(
      "performance.location.sync",
      async (span) => {
        try {
          const accessToken = await connectionAccessToken(
            getDatabase(),
            organisationId,
            location.connectionId
          )
          const window = performanceDateWindow(
            new Date(),
            location.lastMetricDate
          )
          const points = await googlePerformanceMetrics(
            accessToken,
            {
              locationName: location.googleLocationName,
              metrics: GOOGLE_PERFORMANCE_METRICS,
              ...window,
            },
            { connectionKey: location.connectionId }
          )
          const freshThrough = await persistPerformancePoints(
            organisationId,
            location,
            points,
            options.requestId
          )
          performanceSyncCount.add(1, { outcome: "succeeded" })
          return {
            externalLocationId: location.externalLocationId,
            status: "succeeded" as const,
            upserted: points.length,
            freshThrough,
          }
        } catch (error) {
          // failPerformanceSync opens its own transaction, so a database
          // error here would otherwise escape this catch and reject the whole
          // tick. The lease reaper recovers the 'running' row 15 minutes on.
          const errorCode = await failPerformanceSync(
            organisationId,
            location,
            error,
            options.requestId
          ).catch((settleError) => {
            log.error("performance.settle_failed", {
              requestId: options.requestId,
              organisationId,
              externalLocationId: location.externalLocationId,
              error: settleError,
            })
            return "settle_failed"
          })
          performanceSyncCount.add(1, { outcome: "failed", errorCode })
          return {
            externalLocationId: location.externalLocationId,
            status: "failed" as const,
            upserted: 0,
            freshThrough: null,
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

export function isGooglePerformanceMetric(
  value: string
): value is GooglePerformanceMetric {
  return (GOOGLE_PERFORMANCE_METRICS as readonly string[]).includes(value)
}
