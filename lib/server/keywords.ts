import "server-only"

import { metrics, trace } from "@opentelemetry/api"

import { retryDelayMs } from "@/lib/domain/retry"
import { writeAudit } from "@/lib/server/audit"
import { getDatabase, withTenant } from "@/lib/server/db"
import {
  connectionAccessToken,
  googleSearchKeywordImpressions,
  type GoogleSearchKeywordPoint,
} from "@/lib/server/google"
import { log } from "@/lib/server/logger"

const keywordTracer = trace.getTracer("nabapresence.keywords")
const keywordMeter = metrics.getMeter("nabapresence.keywords")
const keywordSyncCount = keywordMeter.createCounter(
  "nabapresence.keyword_sync.count"
)

const INITIAL_MONTHS = 18
const RESTATEMENT_MONTHS = 2

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
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
}

function monthText(date: Date) {
  return date.toISOString().slice(0, 7)
}

export function keywordMonths(
  now: Date,
  lastKeywordMonth: string | null
): string[] {
  const current = firstOfMonth(now)
  const count = lastKeywordMonth ? RESTATEMENT_MONTHS : INITIAL_MONTHS
  return Array.from({ length: count }, (_, index) =>
    monthText(addMonths(current, index - count + 1))
  )
}

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
      do nothing
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

async function persistKeywordMonths(
  organisationId: string,
  location: KeywordLocation,
  batches: Array<{ month: string; points: GoogleSearchKeywordPoint[] }>
) {
  return withTenant(organisationId, async (sql) => {
    let upserted = 0
    for (const batch of batches) {
      await sql`
        delete from performance_search_keyword_monthly
        where external_location_id = ${location.externalLocationId}
          and metric_month = ${`${batch.month}-01`}::date
      `
      const ranked = [...batch.points].sort(
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
            ${`${batch.month}-01`}::date,
            ${point.keyword},
            ${point.impressions},
            ${point.threshold},
            ${index + 1},
            now()
          )
        `
        upserted += 1
      }
    }
    const freshThrough = batches.at(-1)?.month ?? null
    await sql`
      update sync_checkpoint
      set
        status = 'succeeded',
        last_keyword_month = ${freshThrough ? `${freshThrough}-01` : null}::date,
        next_attempt_at = now() + interval '24 hours',
        finished_at = now(),
        last_error_code = null
      where id = ${location.checkpointId}
    `
    await writeAudit(sql, {
      organisationId,
      action: "performance.keywords.synced",
      subjectType: "external_location",
      subjectId: location.externalLocationId,
      requestId: crypto.randomUUID(),
      metadata: { months: batches.length, upserted, freshThrough },
    })
    return { upserted, freshThrough }
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
  error: unknown
) {
  const errorCode = keywordErrorCode(error)
  const delay = Math.max(
    3_600_000,
    Math.min(86_400_000, retryDelayMs(location.attemptCount))
  )
  await withTenant(organisationId, async (sql) => {
    await sql`
      update sync_checkpoint
      set
        status = 'failed',
        last_error_code = ${errorCode},
        next_attempt_at = ${new Date(Date.now() + delay)},
        finished_at = now()
      where id = ${location.checkpointId}
    `
  })
  log.error("performance.keywords.sync_failed", {
    organisationId,
    externalLocationId: location.externalLocationId,
    errorCode,
    error,
  })
  return errorCode
}

export async function syncDueKeywords(
  organisationId: string,
  options: { externalLocationId?: string; maxLocations?: number } = {}
): Promise<KeywordSyncOutcome[]> {
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
        try {
          const accessToken = await connectionAccessToken(
            getDatabase(),
            organisationId,
            location.connectionId
          )
          const months = keywordMonths(new Date(), location.lastKeywordMonth)
          const batches = []
          for (const month of months) {
            batches.push({
              month,
              points: await googleSearchKeywordImpressions(
                accessToken,
                { locationName: location.googleLocationName, month },
                { connectionKey: location.connectionId }
              ),
            })
          }
          const persisted = await persistKeywordMonths(
            organisationId,
            location,
            batches
          )
          keywordSyncCount.add(1, { outcome: "succeeded" })
          return {
            externalLocationId: location.externalLocationId,
            status: "succeeded" as const,
            months: months.length,
            ...persisted,
          }
        } catch (error) {
          const errorCode = await failKeywordSync(
            organisationId,
            location,
            error
          )
          keywordSyncCount.add(1, { outcome: "failed", errorCode })
          return {
            externalLocationId: location.externalLocationId,
            status: "failed" as const,
            months: 0,
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
