import "server-only"

/**
 * The durable background job runner.
 *
 * Shape, in one tick:
 *
 *   reclaim_expired_jobs()   one reaper for every in-flight status
 *   claim_due_jobs(...)      one cross-tenant query -> a fair batch, leased
 *   run the batch            bounded concurrency, one tenant txn per item
 *   repeat                   until the batch comes back empty or time is up
 *
 * Why the claim is a SECURITY DEFINER function: RLS scopes a tenant
 * transaction to one organisation, so finding due work used to mean looping
 * `organisation_job_route` and opening a transaction per organisation per
 * claim -- four scans per iteration and O(tenants) round trips to claim one
 * item, in a fixed organisation order that let a busy early tenant consume
 * the whole budget. `claim_due_jobs` does it in one query, in global due
 * order, capped per organisation. It returns ids and routing columns only;
 * every payload read and every write still happens inside `withTenant()`
 * under RLS.
 *
 * Leases replace the old claim-by-lock. `processed_webhook_event` and
 * `sync_checkpoint` are claimed by status as before, but now carry
 * `lease_expires_at` so a crash between claim and settle is recoverable --
 * previously such a row stranded at 'processing'/'running' forever, because
 * both claim predicates only matched 'failed'/'pending'. Publish attempts in
 * 'retryable'/'ambiguous' keep their status and take a lease instead, which
 * makes those real claims: the previous implementation selected them FOR
 * UPDATE SKIP LOCKED without writing anything, so the row lock died with the
 * claiming transaction while the item was still being worked.
 *
 * Concurrency is bounded by `JOBS_CONCURRENCY` and, independently, by the
 * database pool and the process-local Google pacer
 * (`GOOGLE_REQUESTS_PER_SECOND`). Provider-bound items therefore overlap
 * their database and scheduling latency but not their Google traffic.
 *
 * `/api/jobs/run` still holds the `naba:jobs` advisory lock, so one tick runs
 * at a time. With row-level leases that lock is now an optimisation -- it
 * stops redundant ticks piling up -- rather than the thing that makes
 * claiming safe.
 */

import { retryDelayMs } from "@/lib/domain/retry"
import { writeAudit } from "@/lib/server/audit"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { log } from "@/lib/server/logger"
import { recoverAttempt, retryPublishAttempt } from "@/lib/server/publishing"
import { syncLinkedLocation } from "@/lib/server/reviews"
import { settleWebhookEvent } from "@/lib/server/webhooks"

/** The five things the runner knows how to do. */
export type JobKind =
  "webhook" | "webhook_dead" | "checkpoint" | "recover" | "retry"

type ClaimedJob = {
  kind: JobKind
  jobId: string
  organisationId: string
  externalLocationId: string | null
  syncType: "backfill" | "sweep" | null
  retryCount: number
}

export type JobSummary = {
  webhooks: number
  checkpoints: number
  attempts: number
  dead: number
}

const WEBHOOK_MAX_RETRIES = 5

/**
 * Runs `work` over `items` with at most `limit` in flight. Rejections are
 * impossible: every worker settles its own item.
 */
async function runPool<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        const item = items[cursor]
        cursor += 1
        await work(item)
      }
    }
  )
  await Promise.all(workers)
}

async function reclaimExpired(): Promise<void> {
  const reclaimed = await getDatabase()<
    { kind: string; reclaimed: number }[]
  >`select kind, reclaimed from reclaim_expired_jobs()`
  const stranded = reclaimed.filter((row) => row.reclaimed > 0)
  if (stranded.length) {
    log.warn("jobs.leases_reclaimed", {
      reclaimed: Object.fromEntries(
        stranded.map((row) => [row.kind, row.reclaimed])
      ),
    })
  }
}

async function claimBatch(options: {
  limit: number
  leaseSeconds: number
  perOrganisation: number
}): Promise<ClaimedJob[]> {
  return getDatabase()<ClaimedJob[]>`
    select
      kind,
      job_id::text as "jobId",
      organisation_id::text as "organisationId",
      external_location_id::text as "externalLocationId",
      sync_type as "syncType",
      retry_count as "retryCount"
    from claim_due_jobs(
      ${options.limit},
      ${options.leaseSeconds},
      ${options.perOrganisation}
    )
  `
}

async function releaseLease(job: ClaimedJob): Promise<void> {
  try {
    await getDatabase()`
      select release_job_lease(
        ${job.kind},
        ${job.organisationId}::uuid,
        ${job.jobId}::uuid
      )
    `
  } catch (error) {
    // A lease that outlives its item is harmless -- the reaper collects it.
    log.warn("jobs.lease_release_failed", {
      organisationId: job.organisationId,
      kind: job.kind,
      jobId: job.jobId,
      error,
    })
  }
}

/** Mark a claimed webhook dead and record why, atomically. */
async function markWebhookDead(job: ClaimedJob): Promise<void> {
  await withTenant(job.organisationId, async (sql) => {
    await sql`
      update processed_webhook_event
      set
        status = 'dead',
        processed_at = now(),
        next_attempt_at = null,
        lease_expires_at = null
      where id = ${job.jobId}
    `
    await writeAudit(sql, {
      organisationId: job.organisationId,
      action: "webhook.dead_lettered",
      subjectType: "webhook_event",
      subjectId: job.jobId,
      requestId: crypto.randomUUID(),
      metadata: { retryCount: job.retryCount },
    })
  })
}

async function rescheduleWebhook(job: ClaimedJob, error: unknown) {
  await withTenant(job.organisationId, async (sql) => {
    await sql`
      update processed_webhook_event
      set
        status = 'failed',
        last_error_code = 'job_failed',
        lease_expires_at = null,
        next_attempt_at = ${new Date(Date.now() + retryDelayMs(job.retryCount))}
      where id = ${job.jobId}
    `
  })
  log.error("jobs.webhook_failed", {
    organisationId: job.organisationId,
    eventId: job.jobId,
    error,
  })
}

async function rescheduleCheckpoint(job: ClaimedJob, error: unknown) {
  await withTenant(job.organisationId, async (sql) => {
    await sql`
      update sync_checkpoint
      set
        status = 'failed',
        last_error_code = 'job_failed',
        lease_expires_at = null,
        next_attempt_at = ${new Date(
          Date.now() + retryDelayMs(job.retryCount + 1)
        )},
        finished_at = now()
      where id = ${job.jobId}
    `
  })
  log.error("jobs.checkpoint_failed", {
    organisationId: job.organisationId,
    checkpointId: job.jobId,
    error,
  })
}

async function rescheduleAttempt(job: ClaimedJob, error: unknown) {
  await withTenant(job.organisationId, async (sql) => {
    await sql`
      update publish_attempt
      set
        status = case when status = 'started' then 'ambiguous' else status end,
        provider_error_code = 'job_failed',
        lease_expires_at = null,
        next_attempt_at = ${new Date(Date.now() + retryDelayMs(1))}
      where id = ${job.jobId}
        and status in ('started', 'ambiguous', 'retryable')
    `
  })
  log.error("jobs.attempt_failed", {
    organisationId: job.organisationId,
    attemptId: job.jobId,
    error,
  })
}

/**
 * Runs one claimed item to settlement. Never throws: a failure reschedules
 * the item and is counted, so one poisoned job cannot end the tick.
 */
async function runJob(job: ClaimedJob, summary: JobSummary): Promise<void> {
  try {
    switch (job.kind) {
      case "webhook_dead": {
        summary.webhooks += 1
        summary.dead += 1
        await markWebhookDead(job)
        return
      }

      case "webhook": {
        summary.webhooks += 1
        if (!job.externalLocationId) {
          // An unlinked location can never be synced; retrying is pointless.
          await markWebhookDead(job)
          summary.dead += 1
          return
        }
        const outcome = await syncLinkedLocation({
          organisationId: job.organisationId,
          externalLocationId: job.externalLocationId,
          type: "notification",
          maxPages: 1,
        })
        if (
          outcome.status === "failed" &&
          job.retryCount >= WEBHOOK_MAX_RETRIES
        ) {
          await markWebhookDead(job)
          summary.dead += 1
          return
        }
        await withTenant(job.organisationId, (sql) =>
          settleWebhookEvent(sql, job.jobId, outcome)
        )
        return
      }

      case "checkpoint": {
        summary.checkpoints += 1
        if (!job.externalLocationId || !job.syncType) return
        await syncLinkedLocation({
          organisationId: job.organisationId,
          externalLocationId: job.externalLocationId,
          type: job.syncType,
          maxPages: 5,
        })
        return
      }

      case "recover":
      case "retry": {
        const result =
          job.kind === "recover"
            ? await recoverAttempt({
                organisationId: job.organisationId,
                attemptId: job.jobId,
              })
            : await retryPublishAttempt(job.organisationId, job.jobId)
        if (result !== "skipped") summary.attempts += 1
        return
      }
    }
  } catch (error) {
    if (job.kind === "webhook" || job.kind === "webhook_dead") {
      await rescheduleWebhook(job, error)
    } else if (job.kind === "checkpoint") {
      await rescheduleCheckpoint(job, error)
    } else {
      summary.attempts += 1
      await rescheduleAttempt(job, error)
    }
  } finally {
    await releaseLease(job)
  }
}

export async function runDueJobs(options: {
  budgetMs: number
}): Promise<JobSummary> {
  const env = getServerEnv()
  await getDatabase()`
    insert into ops_heartbeat (name, beat_at)
    values ('scheduler', now())
    on conflict (name) do update
    set beat_at = excluded.beat_at
  `

  await reclaimExpired()

  const deadline = Date.now() + Math.max(0, options.budgetMs)
  const summary: JobSummary = {
    webhooks: 0,
    checkpoints: 0,
    attempts: 0,
    dead: 0,
  }

  // The lease must outlive the slowest item in a batch. Google calls are
  // bounded by GOOGLE_TIMEOUT_MS and a checkpoint runs up to five pages, so
  // the tick budget plus a margin is the right ceiling.
  const leaseSeconds = Math.ceil(options.budgetMs / 1000) + 60

  while (Date.now() < deadline) {
    const batch = await claimBatch({
      limit: env.JOBS_BATCH_SIZE,
      leaseSeconds,
      perOrganisation: env.JOBS_PER_ORGANISATION,
    })
    if (batch.length === 0) break
    await runPool(batch, env.JOBS_CONCURRENCY, (job) => runJob(job, summary))
  }

  return summary
}
