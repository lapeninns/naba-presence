import "server-only"

import { retryDelayMs } from "@/lib/domain/retry"
import { writeAudit } from "@/lib/server/audit"
import { getDatabase, withTenant } from "@/lib/server/db"
import { log } from "@/lib/server/logger"
import {
  recoverAttempt,
  retryPublishAttempt,
} from "@/lib/server/publishing"
import { syncLinkedLocation } from "@/lib/server/reviews"
import { settleWebhookEvent } from "@/lib/server/webhooks"

type ClaimedWebhook = {
  id: string
  organisationId: string
  externalLocationId: string
  retryCount: number
}

type ClaimedCheckpoint = {
  id: string
  organisationId: string
  externalLocationId: string
  syncType: "backfill" | "sweep"
  attemptCount: number
}

type ClaimedAttempt = {
  id: string
  organisationId: string
  mode: "recover" | "retry"
}

async function jobOrganisationIds() {
  return (
    await getDatabase()<{ id: string }[]>`
      select organisation_id::text as id
      from organisation_job_route
      order by organisation_id
    `
  ).map((organisation) => organisation.id)
}

async function deadLetterExhaustedWebhook(
  organisationIds: string[]
): Promise<ClaimedWebhook | null> {
  for (const organisationId of organisationIds) {
    const event = await withTenant<ClaimedWebhook | null>(
      organisationId,
      async (sql) => {
        const [event] = await sql<ClaimedWebhook[]>`
          with candidate as (
            select id
            from processed_webhook_event
            where status = 'failed'
              and retry_count >= 5
              and next_attempt_at <= now()
            order by next_attempt_at, id
            limit 1
            for update skip locked
          )
          update processed_webhook_event p
          set
            status = 'dead',
            processed_at = now(),
            next_attempt_at = null
          from candidate
          where p.id = candidate.id
          returning
            p.id::text as id,
            p.organisation_id::text as "organisationId",
            p.external_location_id::text as "externalLocationId",
            p.retry_count as "retryCount"
        `
        if (!event) return null
        await writeAudit(sql, {
          organisationId,
          action: "webhook.dead_lettered",
          subjectType: "webhook_event",
          subjectId: event.id,
          requestId: crypto.randomUUID(),
          metadata: { retryCount: event.retryCount },
        })
        return event
      }
    )
    if (event) return event
  }
  return null
}

async function claimWebhookEvent(
  organisationIds: string[]
): Promise<ClaimedWebhook | null> {
  for (const organisationId of organisationIds) {
    const event = await withTenant<ClaimedWebhook | null>(
      organisationId,
      async (sql) => {
        const [event] = await sql<ClaimedWebhook[]>`
          with candidate as (
            select id
            from processed_webhook_event
            where status = 'failed'
              and retry_count < 5
              and next_attempt_at <= now()
            order by next_attempt_at, id
            limit 1
            for update skip locked
          )
          update processed_webhook_event p
          set
            status = 'processing',
            retry_count = p.retry_count + 1,
            processed_at = null,
            next_attempt_at = null
          from candidate
          where p.id = candidate.id
          returning
            p.id::text as id,
            p.organisation_id::text as "organisationId",
            p.external_location_id::text as "externalLocationId",
            p.retry_count as "retryCount"
        `
        return event ?? null
      }
    )
    if (event) return event
  }
  return null
}

async function markWebhookDead(event: ClaimedWebhook) {
  await withTenant(event.organisationId, async (sql) => {
    await sql`
      update processed_webhook_event
      set
        status = 'dead',
        processed_at = now(),
        next_attempt_at = null
      where id = ${event.id}
    `
    await writeAudit(sql, {
      organisationId: event.organisationId,
      action: "webhook.dead_lettered",
      subjectType: "webhook_event",
      subjectId: event.id,
      requestId: crypto.randomUUID(),
      metadata: { retryCount: event.retryCount },
    })
  })
}

async function rescheduleWebhook(event: ClaimedWebhook, error: unknown) {
  await withTenant(event.organisationId, async (sql) => {
    await sql`
      update processed_webhook_event
      set
        status = 'failed',
        last_error_code = 'job_failed',
        next_attempt_at = ${
          new Date(Date.now() + retryDelayMs(event.retryCount))
        }
      where id = ${event.id}
    `
  })
  log.error("jobs.webhook_failed", {
    organisationId: event.organisationId,
    eventId: event.id,
    error,
  })
}

async function claimCheckpoint(
  organisationIds: string[]
): Promise<ClaimedCheckpoint | null> {
  for (const organisationId of organisationIds) {
    const checkpoint = await withTenant<ClaimedCheckpoint | null>(
      organisationId,
      async (sql) => {
        const [checkpoint] = await sql<ClaimedCheckpoint[]>`
          with candidate as (
            select id
            from sync_checkpoint
            where status in ('pending', 'failed')
              and next_attempt_at <= now()
              and sync_type in ('backfill', 'sweep')
            order by next_attempt_at, id
            limit 1
            for update skip locked
          )
          update sync_checkpoint s
          set status = 'running', started_at = now()
          from candidate
          where s.id = candidate.id
          returning
            s.id::text as id,
            s.organisation_id::text as "organisationId",
            s.external_location_id::text as "externalLocationId",
            s.sync_type as "syncType",
            s.attempt_count as "attemptCount"
        `
        return checkpoint ?? null
      }
    )
    if (checkpoint) return checkpoint
  }
  return null
}

async function rescheduleCheckpoint(
  checkpoint: ClaimedCheckpoint,
  error: unknown
) {
  await withTenant(checkpoint.organisationId, async (sql) => {
    await sql`
      update sync_checkpoint
      set
        status = 'failed',
        last_error_code = 'job_failed',
        next_attempt_at = ${
          new Date(Date.now() + retryDelayMs(checkpoint.attemptCount + 1))
        },
        finished_at = now()
      where id = ${checkpoint.id}
    `
  })
  log.error("jobs.checkpoint_failed", {
    organisationId: checkpoint.organisationId,
    checkpointId: checkpoint.id,
    error,
  })
}

async function claimAttempt(
  organisationIds: string[]
): Promise<ClaimedAttempt | null> {
  for (const organisationId of organisationIds) {
    const attempt = await withTenant<ClaimedAttempt | null>(
      organisationId,
      async (sql) => {
        const [recovery] = await sql<
          { id: string; organisationId: string }[]
        >`
          with candidate as (
            select id
            from publish_attempt
            where (
                status = 'ambiguous'
                and coalesce(next_attempt_at, now()) <= now()
                and provider_error_code is distinct from 'job_claimed'
              )
              or (
                status = 'started'
                and started_at < now() - interval '10 minutes'
              )
            order by started_at, id
            limit 1
            for update skip locked
          )
          update publish_attempt p
          set
            status = 'ambiguous',
            provider_error_code = 'job_claimed',
            next_attempt_at = null
          from candidate
          where p.id = candidate.id
          returning
            p.id::text as id,
            p.organisation_id::text as "organisationId"
        `
        if (recovery) return { ...recovery, mode: "recover" as const }
        const [retry] = await sql<
          { id: string; organisationId: string }[]
        >`
          select
            id::text as id,
            organisation_id::text as "organisationId"
          from publish_attempt
          where status = 'retryable'
            and next_attempt_at <= now()
          order by next_attempt_at, id
          limit 1
          for update skip locked
        `
        return retry ? { ...retry, mode: "retry" as const } : null
      }
    )
    if (attempt) return attempt
  }
  return null
}

async function rescheduleAttempt(attempt: ClaimedAttempt, error: unknown) {
  await withTenant(attempt.organisationId, async (sql) => {
    await sql`
      update publish_attempt
      set
        status = case
          when status = 'started' then 'ambiguous'
          else status
        end,
        provider_error_code = 'job_failed',
        next_attempt_at = ${new Date(Date.now() + retryDelayMs(1))}
      where id = ${attempt.id}
        and status in ('started', 'ambiguous', 'retryable')
    `
  })
  log.error("jobs.attempt_failed", {
    organisationId: attempt.organisationId,
    attemptId: attempt.id,
    error,
  })
}

export async function runDueJobs(options: {
  budgetMs: number
}): Promise<{
  webhooks: number
  checkpoints: number
  attempts: number
  dead: number
}> {
  await getDatabase()`
    insert into ops_heartbeat (name, beat_at)
    values ('scheduler', now())
    on conflict (name) do update
    set beat_at = excluded.beat_at
  `
  const deadline = Date.now() + Math.max(0, options.budgetMs)
  const organisationIds = await jobOrganisationIds()
  const summary = {
    webhooks: 0,
    checkpoints: 0,
    attempts: 0,
    dead: 0,
  }

  while (Date.now() < deadline) {
    let progressed = false

    const exhausted = await deadLetterExhaustedWebhook(organisationIds)
    if (exhausted) {
      summary.webhooks += 1
      summary.dead += 1
      progressed = true
    }

    if (Date.now() < deadline) {
      const event = await claimWebhookEvent(organisationIds)
      if (event) {
        progressed = true
        summary.webhooks += 1
        try {
          const outcome = await syncLinkedLocation({
            organisationId: event.organisationId,
            externalLocationId: event.externalLocationId,
            type: "notification",
            maxPages: 1,
          })
          if (outcome.status === "failed" && event.retryCount >= 5) {
            await markWebhookDead(event)
            summary.dead += 1
          } else {
            await withTenant(event.organisationId, (sql) =>
              settleWebhookEvent(sql, event.id, outcome)
            )
          }
        } catch (error) {
          await rescheduleWebhook(event, error)
        }
      }
    }

    if (Date.now() < deadline) {
      const checkpoint = await claimCheckpoint(organisationIds)
      if (checkpoint) {
        progressed = true
        summary.checkpoints += 1
        try {
          await syncLinkedLocation({
            organisationId: checkpoint.organisationId,
            externalLocationId: checkpoint.externalLocationId,
            type: checkpoint.syncType,
            maxPages: 5,
          })
        } catch (error) {
          await rescheduleCheckpoint(checkpoint, error)
        }
      }
    }

    if (Date.now() < deadline) {
      const attempt = await claimAttempt(organisationIds)
      if (attempt) {
        try {
          const result =
            attempt.mode === "recover"
              ? await recoverAttempt({
                  organisationId: attempt.organisationId,
                  attemptId: attempt.id,
                })
              : await retryPublishAttempt(
                  attempt.organisationId,
                  attempt.id
                )
          if (result !== "skipped") {
            summary.attempts += 1
            progressed = true
          }
        } catch (error) {
          summary.attempts += 1
          progressed = true
          await rescheduleAttempt(attempt, error)
        }
      }
    }

    if (!progressed) break
  }

  return summary
}
