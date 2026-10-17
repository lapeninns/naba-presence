import "server-only"

import type { TransactionSql } from "postgres"

import type { OperationsHealth } from "@/lib/contracts/operations"
import { retryableDelivery } from "@/lib/server/notifications/retry"
import type { schedulerLiveness } from "@/lib/server/ops-liveness"

/**
 * The organisation's operational read, shared by `GET /api/operations/health`
 * and the Operations page's server prefetch (SET-22), so the counters painted
 * in the first HTML and the ones a later refetch returns are produced the
 * same way (lib/server/operations-prefetch.ts). Both readers run inside
 * the caller's tenant transaction.
 */

export type AlertingFields = Pick<
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
  | "dueReconcileBacklog"
  | "duePublishBacklog"
  | "checkpointFailures24h"
  | "connectionErrors24h"
  | "refreshTokensExpiringSoon"
  | "reconcileStalenessSeconds"
  | "sweepStalenessSeconds"
  | "listingsAccessLost"
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
export async function tenantAlerting(sql: TransactionSql): Promise<AlertingFields> {
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
        where sync_type = 'notification'
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
        -- Recurring reconciles the runner owes (0048): due and not leased.
        -- A reconcile keeps its row at 'succeeded' between runs, so due-ness
        -- is next_attempt_at alone.
        select count(*)::integer
        from sync_checkpoint
        where sync_type = 'reconcile'
          and (
            (
              status in ('pending', 'failed', 'succeeded')
              and next_attempt_at <= now() - interval '2 minutes'
              and coalesce(lease_expires_at, '-infinity'::timestamptz) <= now()
            )
            or (
              status = 'running'
              and coalesce(
                lease_expires_at, started_at + interval '15 minutes'
              ) <= now()
            )
          )
      ) as "dueReconcileBacklog",
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
        -- The WORST actively linked location: how long since its reviews were
        -- last successfully checked. Read from last_succeeded_at, which a
        -- failed reconcile never moves; finished_at did, so a reconcile that
        -- failed every tick used to read as perfectly fresh. A location
        -- never reconciled counts from when it was linked.
        select extract(epoch from (now() - min(coalesce(sc.last_succeeded_at, ll.created_at))))::integer
        from location_link ll
        left join sync_checkpoint sc
          on sc.external_location_id = ll.external_location_id
         and sc.sync_type = 'reconcile'
        where ll.is_active
      ) as "reconcileStalenessSeconds",
      (
        select extract(epoch from (now() - min(coalesce(sc.last_succeeded_at, ll.created_at))))::integer
        from location_link ll
        left join sync_checkpoint sc
          on sc.external_location_id = ll.external_location_id
         and sc.sync_type = 'sweep'
        where ll.is_active
      ) as "sweepStalenessSeconds",
      (
        select count(*)::integer
        from external_location e
        join location_link ll on ll.external_location_id = e.id and ll.is_active
        where e.access_state = 'access_lost'
      ) as "listingsAccessLost",
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
      row.dueReconcileBacklog +
      row.duePublishBacklog,
  }
}

/**
 * Everything the owner's and admin's Operations view reads for one
 * organisation: sync, webhooks, connections, publishing, unresolved Google
 * writes, notification delivery and AI usage, plus the alerting counters.
 * `liveness` is read outside the tenant (the scheduler heartbeat is
 * platform-wide).
 */
export async function loadOrganisationHealth(
  sql: TransactionSql,
  liveness: Awaited<ReturnType<typeof schedulerLiveness>>
): Promise<OperationsHealth> {
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
  const unresolvedWrites = await sql<OperationsHealth["unresolvedWrites"]>`
    select family, count(*)::integer as count, min(created_at)::text as "oldestAt" from (
      select 'links' as family, created_at from place_action_mutation
        where status in ('started', 'ambiguous') or confirmation_state in ('pending', 'unresolved')
      union all select coalesce(resource_type, 'management'), created_at from gbp_management_mutation
        where status in ('started', 'validated', 'ambiguous') or confirmation_state in ('pending', 'unresolved')
      union all select 'hours', created_at from hours_sync_attempt where status = 'ambiguous'
      union all select 'profile', created_at from profile_sync_attempt where status = 'ambiguous'
      union all select 'menus', created_at from food_menus_sync_attempt where status = 'ambiguous'
      union all select 'media', created_at from gbp_media_mutation where status = 'ambiguous'
      union all select 'posts', created_at from gbp_local_post_attempt where status = 'ambiguous'
      union all select 'reviews', started_at from publish_attempt where status = 'ambiguous'
    ) unresolved group by family order by min(created_at)
  `
  const [queuedDeliveries] = await sql<{ queued: number; oldestQueuedAt: string | null; retryable: number }[]>`
    select count(*) filter (where status = 'pending')::integer as queued,
      min(created_at) filter (where status = 'pending')::text as "oldestQueuedAt",
      count(*) filter (where ${retryableDelivery(sql)})::integer as retryable
    from notification_delivery
  `
  const deliveryStates = await sql<{ state: string; count: number }[]>`
    select delivery_state as state, count(*)::integer as count from notification_delivery
    where created_at >= now() - interval '7 days' group by delivery_state order by delivery_state
  `
  const aiTokensThisMonth = await sql<
    OperationsHealth["aiTokensThisMonth"]
  >`
    select
      model,
      coalesce(sum(input_tokens), 0)::integer as "inputTokens",
      coalesce(sum(output_tokens), 0)::integer as "outputTokens"
    from ai_usage
    where period_start = (date_trunc('month', now() at time zone 'utc'))::date
    group by model
    order by model
  `
  return {
    generatedAt: new Date().toISOString(),
    aiTokensThisMonth: [...aiTokensThisMonth],
    sync,
    webhooks,
    connections,
    publish24h: publish,
    replyRejections30d: rejections,
    providerTotalDivergence30d: providerDivergence.count,
    ...alerting,
    ...liveness,
    unresolvedWrites,
    notificationDeliveries: { ...queuedDeliveries, states7d: deliveryStates },
  } satisfies OperationsHealth
}

/** A failed or dead Pub/Sub event as read; the timestamps serialise to ISO. */
type WebhookFailureRow = {
  id: string
  eventType: string
  status: string
  retryCount: number
  nextAttemptAt: Date | null
  lastErrorCode: string | null
  receivedAt: Date
}

/**
 * The failed and dead Pub/Sub events Operations lists for replay
 * (`GET /api/webhooks/google/pubsub/failures`): newest first, at most 100.
 */
export async function loadWebhookFailures(
  sql: TransactionSql
): Promise<{ items: WebhookFailureRow[] }> {
  const items = await sql<WebhookFailureRow[]>`
    select
      id::text as id,
      event_type as "eventType",
      status,
      retry_count as "retryCount",
      next_attempt_at as "nextAttemptAt",
      last_error_code as "lastErrorCode",
      received_at as "receivedAt"
    from processed_webhook_event
    where status in ('failed', 'dead')
    order by received_at desc, id desc
    limit 100
  `
  return { items: [...items] }
}
