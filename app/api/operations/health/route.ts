import { NextResponse } from "next/server"
import type { TransactionSql } from "postgres"

import { secretEqual } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError, apiError } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

type AlertingFields = {
  failedWebhookEvents: number
  deadWebhookEvents: number
  oldestFailedEventAgeSeconds: number | null
  ambiguousPublishAttempts: number
  staleStartedAttempts: number
  dueJobBacklog: number
  checkpointFailures24h: number
  connectionErrors24h: number
}

async function tenantAlerting(sql: TransactionSql): Promise<AlertingFields> {
  const [fields] = await sql<AlertingFields[]>`
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
          and started_at < now() - interval '10 minutes'
      ) as "staleStartedAttempts",
      (
        (
          select count(*)
          from processed_webhook_event
          where status = 'failed'
            and next_attempt_at <= now()
        ) + (
          select count(*)
          from sync_checkpoint
          where status in ('pending', 'failed')
            and next_attempt_at <= now()
        ) + (
          select count(*)
          from publish_attempt
          where (
            status in ('ambiguous', 'retryable')
            and coalesce(next_attempt_at, now()) <= now()
            and provider_error_code is distinct from 'job_claimed'
          ) or (
            status = 'started'
            and started_at < now() - interval '10 minutes'
          )
        )
      )::integer as "dueJobBacklog",
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
      ) as "connectionErrors24h"
  `
  return fields
}

async function schedulerHeartbeatAt() {
  const [heartbeat] = await getDatabase()<
    { schedulerHeartbeatAt: Date | null }[]
  >`
    select beat_at as "schedulerHeartbeatAt"
    from ops_heartbeat
    where name = 'scheduler'
  `
  return heartbeat?.schedulerHeartbeatAt ?? null
}

async function platformHealth() {
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
    checkpointFailures24h: 0,
    connectionErrors24h: 0,
  }
  for (const organisation of organisations) {
    const fields = await withTenant(organisation.id, tenantAlerting)
    totals.failedWebhookEvents += fields.failedWebhookEvents
    totals.deadWebhookEvents += fields.deadWebhookEvents
    totals.ambiguousPublishAttempts += fields.ambiguousPublishAttempts
    totals.staleStartedAttempts += fields.staleStartedAttempts
    totals.dueJobBacklog += fields.dueJobBacklog
    totals.checkpointFailures24h += fields.checkpointFailures24h
    totals.connectionErrors24h += fields.connectionErrors24h
    if (fields.oldestFailedEventAgeSeconds !== null) {
      totals.oldestFailedEventAgeSeconds = Math.max(
        totals.oldestFailedEventAgeSeconds ?? 0,
        fields.oldestFailedEventAgeSeconds
      )
    }
  }
  return {
    scope: "platform",
    generatedAt: new Date().toISOString(),
    organisationCount: organisations.length,
    ...totals,
    schedulerHeartbeatAt: await schedulerHeartbeatAt(),
  }
}

export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.get("scope") === "platform") {
      const token = request.headers
        .get("authorization")
        ?.replace(/^Bearer /, "")
      if (!secretEqual(token, getServerEnv().CRON_SECRET)) {
        throw new ApiError(401, "invalid_cron_token", "Invalid cron token.")
      }
      return NextResponse.json(await platformHealth(), {
        headers: { "cache-control": "no-store" },
      })
    }

    const session = requireRole(await requireSession(), ["owner", "admin"])
    const heartbeat = await schedulerHeartbeatAt()
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
      const connections = await sql`
        select status, count(*)::integer as count
        from google_connection
        group by status
        order by status
      `
      const publish = await sql`
        select
          status,
          count(*)::integer as count
        from publish_attempt
        where started_at >= now() - interval '24 hours'
        group by status
        order by status
      `
      const rejections = await sql`
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
        schedulerHeartbeatAt: heartbeat,
      }
    })
    return NextResponse.json(health, {
      headers: { "cache-control": "private, no-store" },
    })
  } catch (error) {
    return apiError(error)
  }
}
