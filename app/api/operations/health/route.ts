import { NextResponse } from "next/server"
import type { TransactionSql } from "postgres"

import type { OperationsHealth } from "@/lib/contracts/operations"
import { getDatabase, withTenant } from "@/lib/server/db"
import { SCHEDULER_TICK_NAMES } from "@/lib/server/leases"
import { requireCronToken, route } from "@/lib/server/route"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

type AlertingFields = Pick<
  OperationsHealth,
  | "failedWebhookEvents"
  | "deadWebhookEvents"
  | "oldestFailedEventAgeSeconds"
  | "ambiguousPublishAttempts"
  | "staleStartedAttempts"
  | "dueJobBacklog"
  | "dueWebhookBacklog"
  | "dueRunnerCheckpointBacklog"
  | "dueMetricsCheckpointBacklog"
  | "dueUnclaimedCheckpointBacklog"
  | "duePublishBacklog"
  | "checkpointFailures24h"
  | "connectionErrors24h"
  | "refreshTokensExpiringSoon"
  | "reconcileStalenessSeconds"
  | "heldPurgeLocations"
  | "pendingPurgeAgeSeconds"
>

/**
 * Everything the aggregate reads, minus the aggregate. `dueJobBacklog` is the
 * sum of its five sources rather than a sixth subquery, so the total and the
 * breakdown can never disagree.
 */
type AlertingRow = Omit<AlertingFields, "dueJobBacklog">

/**
 * Per-tenant counters, summed across the fleet by `platformHealth`.
 *
 * The backlog is broken out by whoever owes the work rather than narrowed to
 * the job runner's share. Narrowing it to `claim_due_jobs`' own
 * `sync_type in ('backfill','sweep')` would hide genuinely due `performance`
 * and `keywords` checkpoints, which their own crons do claim; leaving it
 * unattributed made a `performance` checkpoint indistinguishable from a
 * wedged runner. Each checkpoint bucket now also carries the reaper arm the
 * webhook and publish terms always had, so an expired lease
 * `reclaim_expired_jobs` is about to collect counts as the backlog it is.
 *
 * `dueUnclaimedCheckpointBacklog` is the one bucket nothing claims;
 * `reconcile` settles straight to succeeded and a stranded `notification` row
 * dead-letters (0030), so it drains to zero rather than latching.
 */
async function tenantAlerting(sql: TransactionSql): Promise<AlertingFields> {
  const [row] = await sql<AlertingRow[]>`
    select
      (
        select count(*)::integer
        from processed_webhook_event
        where status = 'failed'
      ) as "failedWebhookEvents",
      (
        select count(*)::integer
        from processed_webhook_event
        where status = 'dead'
      ) as "deadWebhookEvents",
      (
        select extract(epoch from (now() - min(received_at)))::integer
        from processed_webhook_event
        where status = 'failed'
      ) as "oldestFailedEventAgeSeconds",
      (
        select count(*)::integer
        from publish_attempt
        where status = 'ambiguous'
      ) as "ambiguousPublishAttempts",
      (
        select count(*)::integer
        from publish_attempt
        where status = 'started'
          and coalesce(
            lease_expires_at, started_at + interval '10 minutes'
          ) <= now()
      ) as "staleStartedAttempts",
      (
        select count(*)::integer
        from processed_webhook_event
        where (status = 'failed' and next_attempt_at <= now())
          or (
            status = 'processing'
            and coalesce(
              lease_expires_at, received_at + interval '15 minutes'
            ) <= now()
          )
      ) as "dueWebhookBacklog",
      (
        select count(*)::integer
        from sync_checkpoint
        where sync_type in ('backfill', 'sweep')
          and (
            (status in ('pending', 'failed') and next_attempt_at <= now())
            or (
              status = 'running'
              and coalesce(
                lease_expires_at, started_at + interval '15 minutes'
              ) <= now()
            )
          )
      ) as "dueRunnerCheckpointBacklog",
      (
        select count(*)::integer
        from sync_checkpoint
        where sync_type in ('performance', 'keywords')
          and dead_lettered_at is null
          and (
            (status in ('pending', 'failed') and next_attempt_at <= now())
            or (
              status = 'running'
              and coalesce(
                lease_expires_at, started_at + interval '15 minutes'
              ) <= now()
            )
          )
      ) as "dueMetricsCheckpointBacklog",
      (
        select count(*)::integer
        from sync_checkpoint
        where sync_type in ('reconcile', 'notification')
          and (
            (status in ('pending', 'failed') and next_attempt_at <= now())
            or (
              status = 'running'
              and coalesce(
                lease_expires_at, started_at + interval '15 minutes'
              ) <= now()
            )
          )
      ) as "dueUnclaimedCheckpointBacklog",
      (
        select count(*)::integer
        from publish_attempt
        -- The recovery ceiling is the same 8 the recover arm of
        -- claim_due_jobs enforces (0034) and MAX_RECOVERY_ATTEMPTS in
        -- lib/server/jobs.ts settles on. An attempt whose terminal settle was
        -- lost at exactly that count is unclaimable, so counting it would
        -- pin the gauge above zero for good.
        where (
          status in ('ambiguous', 'retryable')
          and coalesce(next_attempt_at, now()) <= now()
          and coalesce(lease_expires_at, '-infinity'::timestamptz) <= now()
          and (status <> 'ambiguous' or recovery_attempts < 8)
        ) or (
          status = 'started'
          and coalesce(
            lease_expires_at, started_at + interval '10 minutes'
          ) <= now()
        )
      ) as "duePublishBacklog",
      (
        select count(*)::integer
        from sync_checkpoint
        where status = 'failed'
          and updated_at >= now() - interval '24 hours'
      ) as "checkpointFailures24h",
      (
        select count(*)::integer
        from google_connection
        where last_error_code is not null
          and updated_at >= now() - interval '24 hours'
      ) as "connectionErrors24h",
      (
        select count(*)::integer
        from google_connection
        -- Google issues seven-day refresh tokens while the OAuth client is in
        -- Testing publishing status, so the cliff arrives with no other
        -- signal: every refresh starts failing at once. Terminal connections
        -- are excluded because reconnecting them is already the ask.
        where status not in ('disconnected', 'revoked')
          and refresh_token_expires_at is not null
          and refresh_token_expires_at <= now() + interval '3 days'
      ) as "refreshTokensExpiringSoon",
      (
        select extract(epoch from (now() - max(finished_at)))::integer
        from sync_checkpoint
        where sync_type = 'reconcile'
          and finished_at is not null
      ) as "reconcileStalenessSeconds",
      (
        select count(*)::integer
        from external_location l
        where l.google_connection_id in (
          select id from google_connection
          where status = 'disconnected'
            and purge_due_at <= now()
        )
          and exists (
            select 1 from review r
            join legal_hold h
              on h.review_id = r.id and h.released_at is null
            where r.external_location_id = l.id
          )
      ) as "heldPurgeLocations",
      (
        select extract(epoch from (now() - min(c.purge_due_at)))::integer
        from google_connection c
        where c.status = 'disconnected'
          and c.purge_due_at <= now()
          and exists (
            select 1 from external_location l
            where l.google_connection_id = c.id
          )
      ) as "pendingPurgeAgeSeconds"
  `
  return {
    ...row,
    dueJobBacklog:
      row.dueWebhookBacklog +
      row.dueRunnerCheckpointBacklog +
      row.dueMetricsCheckpointBacklog +
      row.dueUnclaimedCheckpointBacklog +
      row.duePublishBacklog,
  }
}

/**
 * How long each tick may go without completing before its absence is worth
 * acting on: a small multiple of the interval `scripts/scheduler.mjs`
 * documents for it, so one missed run is noise and a stopped tick is not.
 * Change these together with the scheduler's defaults.
 */
const TICK_STALE_AFTER_SECONDS: Record<string, number> = {
  // 60s tick; matches the five-minute "scheduler silent" rule in
  // docs/observability.md.
  jobs: 300,
  // 900s ticks, three intervals.
  reconcile: 2_700,
  "presence-resources": 2_700,
  // 21600s tick, three intervals.
  performance: 64_800,
  // 86400s ticks, two intervals.
  retention: 172_800,
  keywords: 172_800,
}

const SCHEDULER_STALE_AFTER_SECONDS = TICK_STALE_AFTER_SECONDS.jobs

type SchedulerLiveness = Pick<
  OperationsHealth,
  "schedulerHeartbeatAt" | "schedulerHeartbeatStale" | "schedulerTicks"
>

/**
 * Liveness for the scheduler process and for each tick it drives.
 *
 * `schedulerHeartbeatAt` is still the row the jobs tick writes even while
 * paused, so it keeps meaning "the scheduler reached the web process". Each
 * per-tick row is stamped by that tick's advisory lease on a completed run
 * (lib/server/leases.ts), so a tick that has been failing, skipping on a
 * wedged lock, or never registered at all reports as stale instead of hiding
 * behind the jobs tick's heartbeat.
 */
async function schedulerLiveness(): Promise<SchedulerLiveness> {
  // Platform-level read: ops_heartbeat is not tenant-scoped, so it is read
  // outside withTenant.
  const rows = await getDatabase()<{ name: string; beatAt: Date }[]>`
    select name, beat_at as "beatAt"
    from ops_heartbeat
  `
  const beats = new Map(rows.map((row) => [row.name, row.beatAt]))
  const ageSeconds = (beatAt: Date | undefined) =>
    beatAt ? (Date.now() - beatAt.getTime()) / 1000 : null
  const scheduler = beats.get("scheduler")
  const schedulerAge = ageSeconds(scheduler)
  return {
    // Normalised here so the tenant projection below can be checked against
    // the wire contract; `NextResponse.json` would have emitted the same ISO
    // string from the `Date`.
    schedulerHeartbeatAt: scheduler?.toISOString() ?? null,
    schedulerHeartbeatStale:
      schedulerAge === null || schedulerAge > SCHEDULER_STALE_AFTER_SECONDS,
    schedulerTicks: SCHEDULER_TICK_NAMES.map((name) => {
      const beatAt = beats.get(name)
      const age = ageSeconds(beatAt)
      const staleAfterSeconds =
        TICK_STALE_AFTER_SECONDS[name] ?? SCHEDULER_STALE_AFTER_SECONDS
      return {
        name,
        lastCompletedAt: beatAt?.toISOString() ?? null,
        staleAfterSeconds,
        stale: age === null || age > staleAfterSeconds,
      }
    }),
  }
}

async function platformHealth() {
  // Cross-tenant enumeration: the platform monitor walks every organisation
  // that has a job route, so this one read deliberately runs outside
  // withTenant; each organisation's counters are then read inside its tenant.
  const organisations = await getDatabase()<{ id: string }[]>`
    select organisation_id::text as id
    from organisation_job_route
    order by organisation_id
  `
  const totals: AlertingFields = {
    failedWebhookEvents: 0,
    deadWebhookEvents: 0,
    oldestFailedEventAgeSeconds: null,
    ambiguousPublishAttempts: 0,
    staleStartedAttempts: 0,
    dueJobBacklog: 0,
    dueWebhookBacklog: 0,
    dueRunnerCheckpointBacklog: 0,
    dueMetricsCheckpointBacklog: 0,
    dueUnclaimedCheckpointBacklog: 0,
    duePublishBacklog: 0,
    checkpointFailures24h: 0,
    connectionErrors24h: 0,
    refreshTokensExpiringSoon: 0,
    reconcileStalenessSeconds: null,
    heldPurgeLocations: 0,
    pendingPurgeAgeSeconds: null,
  }
  // Counters add across the fleet; the three age/staleness fields are
  // "the worst tenant", so they take the maximum and stay null until some
  // tenant reports one.
  const SUMMED = [
    "failedWebhookEvents",
    "deadWebhookEvents",
    "ambiguousPublishAttempts",
    "staleStartedAttempts",
    "dueJobBacklog",
    "dueWebhookBacklog",
    "dueRunnerCheckpointBacklog",
    "dueMetricsCheckpointBacklog",
    "dueUnclaimedCheckpointBacklog",
    "duePublishBacklog",
    "checkpointFailures24h",
    "connectionErrors24h",
    "refreshTokensExpiringSoon",
    "heldPurgeLocations",
  ] as const
  const MAXIMISED = [
    "oldestFailedEventAgeSeconds",
    "reconcileStalenessSeconds",
    "pendingPurgeAgeSeconds",
  ] as const
  for (const organisation of organisations) {
    const fields = await withTenant(organisation.id, tenantAlerting)
    for (const key of SUMMED) totals[key] += fields[key]
    for (const key of MAXIMISED) {
      const value = fields[key]
      if (value !== null) {
        totals[key] = Math.max(totals[key] ?? 0, value)
      }
    }
  }
  return {
    scope: "platform",
    generatedAt: new Date().toISOString(),
    organisationCount: organisations.length,
    ...totals,
    ...(await schedulerLiveness()),
  }
}

// Session-or-cron hybrid: `?scope=platform` is authenticated with the cron
// bearer token, everything else with an owner/admin session. Neither wrapper
// mode covers both, so the route is "public" and does its own auth per branch.
export const GET = route({
  auth: "public",
  query: (searchParams) => ({
    platform: searchParams.get("scope") === "platform",
  }),
  handler: async ({ request, query }) => {
    if (query.platform) {
      requireCronToken(request)
      return NextResponse.json(await platformHealth(), {
        headers: { "cache-control": "no-store" },
      })
    }

    const session = requireRole(await requireSession(), ["owner", "admin"])
    const liveness = await schedulerLiveness()
    const health = await withTenant(session.organisationId, async (sql) => {
      const [sync] = await sql`
        select
          count(*) filter (where status = 'running')::integer as running,
          count(*) filter (where status = 'pending')::integer as pending,
          count(*) filter (where status = 'failed')::integer as failed,
          max(last_review_update_time) as "lastSuccessfulReviewUpdate",
          min(created_at) filter (
            where status in ('pending', 'running')
          ) as "oldestOutstandingAt"
        from sync_checkpoint
      `
      const [webhooks] = await sql`
        select
          count(*) filter (
            where status in ('received', 'failed')
          )::integer as backlog,
          min(received_at) filter (
            where status in ('received', 'failed')
          ) as "oldestBacklogAt",
          count(*) filter (
            where status = 'failed'
              and received_at >= now() - interval '24 hours'
          )::integer as "failures24h"
        from processed_webhook_event
      `
      const connections = await sql<OperationsHealth["connections"]>`
        select status, count(*)::integer as count
        from google_connection
        group by status
        order by status
      `
      const publish = await sql<OperationsHealth["publish24h"]>`
        select
          status,
          count(*)::integer as count
        from publish_attempt
        where started_at >= now() - interval '24 hours'
        group by status
        order by status
      `
      const rejections = await sql<OperationsHealth["replyRejections30d"]>`
        select
          coalesce(google_policy_violation, 'unspecified') as code,
          count(*)::integer as count
        from review_reply
        where google_reply_state = 'REJECTED'
          and updated_at >= now() - interval '30 days'
        group by google_policy_violation
        order by count desc
      `
      const [providerDivergence] = await sql<{ count: number }[]>`
        with local_totals as (
          select
            external_location_id,
            count(*)::integer as review_count,
            avg(star_rating)::float as average_rating
          from review
          where provider_deleted_at is null
          group by external_location_id
        )
        select count(*) filter (
          where (
            e.google_total_review_count is not null
            and abs(
              e.google_total_review_count -
              coalesce(lt.review_count, 0)
            )::float / greatest(e.google_total_review_count, 1) > 0.02
          ) or (
            e.google_average_rating is not null
            and lt.average_rating is not null
            and abs(
              e.google_average_rating::float - lt.average_rating
            ) > 0.1
          )
        )::integer as count
        from external_location e
        left join local_totals lt
          on lt.external_location_id = e.id
        where e.provider_totals_refreshed_at >=
          now() - interval '30 days'
      `
      const alerting = await tenantAlerting(sql)
      return {
        generatedAt: new Date().toISOString(),
        sync,
        webhooks,
        connections,
        publish24h: publish,
        replyRejections30d: rejections,
        providerTotalDivergence30d: providerDivergence.count,
        ...alerting,
        ...liveness,
      } satisfies OperationsHealth
    })
    return NextResponse.json(health, {
      headers: { "cache-control": "private, no-store" },
    })
  },
})
