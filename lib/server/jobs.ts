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
 * The kill switches are enforced at the claim, not inside the work: a claimed
 * row is already 'running' with a lease, so a runner that claims and then
 * skips re-arms the row every tick and reports a backlog that is only its own
 * churn. `claimableKinds` turns the flags into the `p_kinds` filter, and a
 * paused kind keeps its status and its `next_attempt_at` until the flag comes
 * back (docs/runbook.md, "Kill switches").
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

import type { TransactionSql } from "postgres"

import { retryDelayMs } from "@/lib/domain/retry"
import { writeAudit } from "@/lib/server/audit"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv, type ServerEnv } from "@/lib/server/env"
import { log } from "@/lib/server/logger"
import {
  recoverAttempt,
  retryPublishAttempt,
  writePublishAttemptEvent,
} from "@/lib/server/publishing"
import { syncLinkedLocation } from "@/lib/server/reviews"
import { settleWebhookEvent } from "@/lib/server/webhooks"

/** The five things the runner knows how to do. */
const JOB_KINDS = [
  "webhook",
  "webhook_dead",
  "checkpoint",
  "recover",
  "retry",
] as const

export type JobKind = (typeof JOB_KINDS)[number]

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

/** What one tick shares with every item it runs. */
type Tick = {
  /** The run's `ctx.requestId`, correlating every row this tick writes. */
  requestId: string
  summary: JobSummary
}

const WEBHOOK_MAX_RETRIES = 5

/**
 * How many failed readbacks an ambiguous attempt gets before it stops being
 * claimable. Mirrored by `recovery_attempts < 8` in `claim_due_jobs` (0034),
 * so the ceiling holds even if this settle is ever lost.
 */
const MAX_RECOVERY_ATTEMPTS = 8

/**
 * Recovery back-off. Slower and longer-tailed than the publish retry curve:
 * a readback is cheap but the thing it is waiting for -- a Google outage, a
 * propagation delay -- is measured in minutes, and the eight attempts have to
 * span enough of one that a transient fault is not mistaken for a permanent
 * unreadable review.
 */
const RECOVERY_RETRY_BASE_MS = 2_000
const RECOVERY_RETRY_CAP_MS = 300_000

/** How long a reconnect-blocked attempt waits before it looks again. */
const RECOVERY_PARK_MS = 15 * 60_000

/**
 * How long an attempt may stay reconnect-blocked before it is abandoned.
 * Twice the seven-day disconnect purge window, so a tenant who is going to
 * come back has had every chance to.
 */
const RECOVERY_PARK_LIMIT = "14 days"

function recoveryDelayMs(attempts: number) {
  return retryDelayMs(
    attempts,
    Math.random,
    RECOVERY_RETRY_BASE_MS,
    RECOVERY_RETRY_CAP_MS
  )
}

/**
 * The kinds this process may claim. `PUBLISH_ENABLED` covers the two publish
 * kinds and `SYNC_ENABLED` the three ingestion kinds, exactly as the runbook
 * describes them; `JOBS_ENABLED` off claims nothing at all.
 */
function claimableKinds(env: ServerEnv): JobKind[] {
  if (!env.JOBS_ENABLED) return []
  return JOB_KINDS.filter((kind) =>
    kind === "recover" || kind === "retry"
      ? env.PUBLISH_ENABLED
      : env.SYNC_ENABLED
  )
}

/**
 * Runs `work` over `items` with at most `limit` in flight, stopping at the
 * tick deadline. Rejections are impossible: every worker settles its own
 * item. Items the deadline leaves unstarted keep their lease and are
 * re-armed by the reaper -- which, unlike a claim, costs no retry budget.
 */
async function runPool<T>(
  items: readonly T[],
  limit: number,
  deadline: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0
  // Shared across the workers. Nothing in a batch may still be calling Google
  // after the tick has answered its HTTP request, so a worker that somehow
  // rejects stops its siblings pulling new items, and all of them are awaited
  // even then. Whatever is already in flight is left to settle: killing an
  // item mid-provider-call is what creates ambiguous attempts.
  let stopped = false
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (!stopped && cursor < items.length && Date.now() < deadline) {
        const item = items[cursor]
        cursor += 1
        try {
          await work(item)
        } catch (error) {
          stopped = true
          throw error
        }
      }
    }
  )
  for (const result of await Promise.allSettled(workers)) {
    if (result.status === "rejected") throw result.reason
  }
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
  kinds: JobKind[]
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
      ${options.perOrganisation},
      ${options.kinds}::text[]
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
async function markWebhookDead(
  job: ClaimedJob,
  requestId: string
): Promise<void> {
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
      requestId,
      metadata: { retryCount: job.retryCount },
    })
  })
}

async function rescheduleWebhook(job: ClaimedJob, error: unknown) {
  await withTenant(job.organisationId, async (sql) => {
    // `and status = 'processing'` for the same reason settleWebhookEvent
    // carries it: a claim the reaper already took back must not be counted
    // against the retry budget twice, nor resurrect a row it no longer owns.
    await sql`
      update processed_webhook_event
      set
        status = 'failed',
        last_error_code = 'job_failed',
        retry_count = retry_count + 1,
        lease_expires_at = null,
        next_attempt_at = ${new Date(
          Date.now() + retryDelayMs(job.retryCount + 1)
        )}
      where id = ${job.jobId}
        and status = 'processing'
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
    // Only a row this tick still holds: `syncLinkedLocation` settles its own
    // failures, including the terminal 'dead' one, and re-arming that here
    // would put a dead-lettered checkpoint back in the claim window.
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
        and status = 'running'
    `
  })
  log.error("jobs.checkpoint_failed", {
    organisationId: job.organisationId,
    checkpointId: job.jobId,
    error,
  })
}

/**
 * `syncLinkedLocation` reports `location_not_linked` before it touches the
 * checkpoint, so the row this tick moved to 'running' would otherwise be
 * re-armed by the reaper every 15 minutes for ever -- and an unlinked
 * location has no work left to do. 'cancelled' is terminal (0030) and, with
 * no `next_attempt_at`, drops the row out of the backlog gauge too.
 */
async function cancelUnlinkedCheckpoint(job: ClaimedJob): Promise<void> {
  await withTenant(job.organisationId, async (sql) => {
    await sql`
      update sync_checkpoint
      set
        status = 'cancelled',
        last_error_code = 'location_not_linked',
        next_attempt_at = null,
        finished_at = now(),
        lease_expires_at = null
      where id = ${job.jobId}
        and status = 'running'
    `
  })
  log.warn("jobs.checkpoint_cancelled", {
    organisationId: job.organisationId,
    checkpointId: job.jobId,
    errorCode: "location_not_linked",
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
        next_attempt_at = ${new Date(
          Date.now() + retryDelayMs(job.retryCount + 1)
        )}
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
 * The terminal settle for an attempt whose connection the tenant disconnected.
 *
 * Every other blocked state parks, because a person is expected to end it.
 * Disconnecting is not an outage being waited out -- it is the instruction to
 * stop -- and the route that carries it out already settles exactly this way,
 * in the same transaction, for every attempt it can see ('ambiguous' and
 * 'retryable'). It leaves 'started' alone because that write may have landed;
 * those arrive HERE as 'ambiguous' once `reclaim_expired_jobs` takes the lease
 * back. Settling them identically is what stops an attempt's fate depending on
 * which side of the disconnect its lease happened to expire on.
 *
 * This settle DOES fail the reply, where recovery_exhausted and
 * reconnect_abandoned deliberately do not, and for the reason those two give:
 * an 'ambiguous' write may have landed, so 'unknown' is the honest state only
 * while somebody can still go and look. Nobody can here -- the links are
 * inactive, the routes are gone and the location is queued for the seven-day
 * purge -- so the review would sit at 'publish_requested' until that purge
 * deleted it, with nothing on the record to say the reply never landed, and
 * for ever behind a legal hold the purge never reaches. The audit row is what
 * a tenant who reconnects the same Google account has to work from.
 */
async function settleDisconnectedRecovery(
  sql: TransactionSql,
  job: ClaimedJob,
  requestId: string,
  attempt: { reviewId: string; reviewReplyId: string }
): Promise<void> {
  await sql`
    update publish_attempt
    set
      status = 'failed',
      provider_error_code = 'connection_disconnected',
      next_attempt_at = null,
      lease_expires_at = null,
      finished_at = now()
    where id = ${job.jobId}
      and status = 'ambiguous'
  `
  await writePublishAttemptEvent(sql, {
    organisationId: job.organisationId,
    publishAttemptId: job.jobId,
    eventType: "completed",
    payload: { result: "connection_disconnected" },
  })
  // Both guards are the disconnect route's, for its reasons: a reply already
  // 'published' is live at Google and would start lying, and
  // enforce_review_workflow_transition only allows 'failed' out of
  // 'publish_requested', raising rather than skipping on anything else.
  await sql`
    update review_reply
    set publish_status = 'failed'
    where id = ${attempt.reviewReplyId}
      and publish_status = 'accepted'
  `
  await sql`
    update review
    set workflow_status = 'failed'
    where id = ${attempt.reviewId}
      and workflow_status = 'publish_requested'
  `
  await writeAudit(sql, {
    organisationId: job.organisationId,
    action: "review.reply.connection_disconnected",
    subjectType: "review",
    subjectId: attempt.reviewId,
    requestId,
    metadata: { publishAttemptId: job.jobId },
  })
}

/**
 * A recovery readback that failed, settled against `recovery_attempts` (0034)
 * rather than `attempt_no`: nothing on this path increments `attempt_no`, so
 * every back-off derived from it was the same 250-500 ms and the attempt
 * re-armed itself for ever.
 *
 * A reconnect-blocked attempt parks WITHOUT counting. `readGoogleReview`
 * surfaces every failure as `GoogleMutationAmbiguousError`, so the exception
 * cannot tell a dead connection from an unreadable review -- the connection
 * can. Work blocked on a person reconnecting must not spend a budget nobody
 * could have made it spend more slowly, or a queued reply is dead-lettered
 * for the length of an outage the tenant alone can end.
 *
 * A DISCONNECTED connection is the one blocked state that is not an outage,
 * so it is settled rather than parked -- see `settleDisconnectedRecovery`.
 */
async function settleRecoveryFailure(
  job: ClaimedJob,
  error: unknown,
  requestId: string
): Promise<void> {
  const outcome = await withTenant(job.organisationId, async (sql) => {
    const [attempt] = await sql<
      {
        recoveryAttempts: number
        reviewId: string
        reviewReplyId: string
        disconnected: boolean
        blocked: boolean
        abandoned: boolean
      }[]
    >`
      select
        pa.recovery_attempts as "recoveryAttempts",
        rr.review_id::text as "reviewId",
        rr.id::text as "reviewReplyId",
        pa.started_at < now() - ${RECOVERY_PARK_LIMIT}::interval as abandoned,
        (gc.id is null or gc.status = 'disconnected') as disconnected,
        (
          gc.id is null
          or gc.status not in ('active', 'expired')
          or exists (
            select 1
            from connection_task ct
            where ct.google_connection_id = gc.id
              and ct.task_type = 'reconnect'
              and ct.status = 'open'
          )
        ) as blocked
      from publish_attempt pa
      join review_reply rr on rr.id = pa.review_reply_id
      join review r on r.id = rr.review_id
      join external_location el on el.id = r.external_location_id
      left join google_connection gc on gc.id = el.google_connection_id
      where pa.id = ${job.jobId}
        and pa.status = 'ambiguous'
      limit 1
    `
    if (!attempt) return "stale"

    // Checked before `blocked`, which a disconnected connection also
    // satisfies -- as does a connection row that is gone entirely, and that
    // is no more readable than a disconnected one.
    if (attempt.disconnected) {
      await settleDisconnectedRecovery(sql, job, requestId, attempt)
      return "disconnected"
    }

    if (attempt.blocked && !attempt.abandoned) {
      await sql`
        update publish_attempt
        set
          provider_error_code = 'reconnect_blocked',
          lease_expires_at = null,
          next_attempt_at = ${new Date(Date.now() + RECOVERY_PARK_MS)}
        where id = ${job.jobId}
          and status = 'ambiguous'
      `
      return "parked"
    }

    // Parking is unbounded in ATTEMPTS by design (conflicts.md C5):
    // reconnecting upserts on (organisation_id, google_subject) and flips the
    // connection back to 'active', so a revoked or expired grant really is
    // curable by a person, and spending the recovery budget on it would
    // dead-letter a reply for the length of an outage only the tenant can end.
    // It is bounded in TIME instead: a grant nobody restores in two weeks --
    // twice the disconnect purge window -- is abandoned, and the attempt stops
    // taking a claim slot in every tick forever. Settled like exhaustion:
    // never `applyFailedReply`, because 'ambiguous' means the write may have
    // landed at Google and failing the reply would assert a state nobody saw.
    if (attempt.blocked) {
      await sql`
        update publish_attempt
        set
          status = 'failed',
          provider_error_code = 'reconnect_abandoned',
          next_attempt_at = null,
          lease_expires_at = null,
          finished_at = now()
        where id = ${job.jobId}
          and status = 'ambiguous'
      `
      await writePublishAttemptEvent(sql, {
        organisationId: job.organisationId,
        publishAttemptId: job.jobId,
        eventType: "completed",
        payload: { result: "reconnect_abandoned" },
      })
      await writeAudit(sql, {
        organisationId: job.organisationId,
        action: "review.reply.reconnect_abandoned",
        subjectType: "review",
        subjectId: attempt.reviewId,
        requestId,
        metadata: { publishAttemptId: job.jobId },
      })
      return "abandoned"
    }

    const attempts = attempt.recoveryAttempts + 1
    if (attempts < MAX_RECOVERY_ATTEMPTS) {
      await sql`
        update publish_attempt
        set
          provider_error_code = 'job_failed',
          recovery_attempts = ${attempts},
          lease_expires_at = null,
          next_attempt_at = ${new Date(Date.now() + recoveryDelayMs(attempts))}
        where id = ${job.jobId}
          and status = 'ambiguous'
      `
      return "rescheduled"
    }

    // Terminal, but deliberately NOT `applyFailedReply`: 'ambiguous' means
    // the write may have landed at Google, and failing the reply would assert
    // a provider state nobody ever observed. The attempt stops being
    // claimable; the audit row is the operator's handle for a manual readback
    // (docs/runbook.md, "Jobs runner").
    await sql`
      update publish_attempt
      set
        status = 'failed',
        provider_error_code = 'recovery_exhausted',
        recovery_attempts = ${attempts},
        next_attempt_at = null,
        lease_expires_at = null,
        finished_at = now()
      where id = ${job.jobId}
        and status = 'ambiguous'
    `
    await writePublishAttemptEvent(sql, {
      organisationId: job.organisationId,
      publishAttemptId: job.jobId,
      eventType: "completed",
      payload: { result: "recovery_exhausted", recoveryAttempts: attempts },
    })
    await writeAudit(sql, {
      organisationId: job.organisationId,
      action: "review.reply.recovery_exhausted",
      subjectType: "review",
      subjectId: attempt.reviewId,
      requestId,
      metadata: { publishAttemptId: job.jobId, recoveryAttempts: attempts },
    })
    return "exhausted"
  })
  const terminal =
    outcome === "exhausted" ||
    outcome === "abandoned" ||
    outcome === "disconnected"
  log[terminal ? "error" : "warn"]("jobs.recovery_failed", {
    organisationId: job.organisationId,
    attemptId: job.jobId,
    outcome,
    error,
  })
}

/**
 * Runs one claimed item to settlement. Never throws: a failure reschedules
 * the item and is counted, so one poisoned job cannot end the tick.
 */
async function runJob(job: ClaimedJob, tick: Tick): Promise<void> {
  try {
    switch (job.kind) {
      case "webhook_dead": {
        tick.summary.webhooks += 1
        tick.summary.dead += 1
        await markWebhookDead(job, tick.requestId)
        return
      }

      case "webhook": {
        tick.summary.webhooks += 1
        if (!job.externalLocationId) {
          // An unlinked location can never be synced; retrying is pointless.
          await markWebhookDead(job, tick.requestId)
          tick.summary.dead += 1
          return
        }
        const outcome = await syncLinkedLocation({
          organisationId: job.organisationId,
          externalLocationId: job.externalLocationId,
          type: "notification",
          maxPages: 1,
          requestId: tick.requestId,
        })
        const settlement = await withTenant(job.organisationId, async (sql) => {
          const status = await settleWebhookEvent(sql, job.jobId, outcome)
          if (status === "failed") {
            // The claim counts claims (`claim_count`, 0034); the retry budget
            // counts failures, and this is the only place one is observed.
            await sql`
              update processed_webhook_event
              set retry_count = retry_count + 1
              where id = ${job.jobId}
                and status = 'failed'
            `
          }
          return status
        })
        // `job.retryCount` is the count BEFORE this failure, so this is the
        // last one the budget allows. Dead-lettering it here rather than
        // waiting for the next tick's 'webhook_dead' claim keeps the terminal
        // state, its audit row and the failure that earned it in one tick.
        if (
          settlement === "failed" &&
          job.retryCount + 1 >= WEBHOOK_MAX_RETRIES
        ) {
          await markWebhookDead(job, tick.requestId)
          tick.summary.dead += 1
        }
        return
      }

      case "checkpoint": {
        tick.summary.checkpoints += 1
        if (!job.externalLocationId || !job.syncType) return
        const outcome = await syncLinkedLocation({
          organisationId: job.organisationId,
          externalLocationId: job.externalLocationId,
          type: job.syncType,
          maxPages: 5,
          requestId: tick.requestId,
        })
        if (
          outcome.status === "failed" &&
          outcome.errorCode === "location_not_linked"
        ) {
          await cancelUnlinkedCheckpoint(job)
        }
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
        if (result !== "skipped") tick.summary.attempts += 1
        return
      }
    }
  } catch (error) {
    try {
      if (job.kind === "webhook" || job.kind === "webhook_dead") {
        await rescheduleWebhook(job, error)
      } else if (job.kind === "checkpoint") {
        await rescheduleCheckpoint(job, error)
      } else {
        tick.summary.attempts += 1
        if (job.kind === "recover") {
          await settleRecoveryFailure(job, error, tick.requestId)
        } else {
          await rescheduleAttempt(job, error)
        }
      }
    } catch (rescheduleError) {
      // Makes the contract above true. A throw from here would abort the
      // tick, release the advisory lock and answer the request while the rest
      // of the batch is still mutating claimed rows; the lease is the
      // recovery path, so the reaper collects whatever this failed to settle.
      log.error("jobs.reschedule_failed", {
        organisationId: job.organisationId,
        kind: job.kind,
        jobId: job.jobId,
        error,
        rescheduleError,
      })
    }
  } finally {
    await releaseLease(job)
  }
}

export async function runDueJobs(options: {
  budgetMs: number
  requestId: string
}): Promise<JobSummary> {
  const env = getServerEnv()
  // Written even while paused: the heartbeat means "the scheduler reached the
  // web process", which on-call alerts on, and a kill switch must not read as
  // a dead scheduler.
  await getDatabase()`
    insert into ops_heartbeat (name, beat_at)
    values ('scheduler', now())
    on conflict (name) do update
    set beat_at = excluded.beat_at
  `

  const summary: JobSummary = {
    webhooks: 0,
    checkpoints: 0,
    attempts: 0,
    dead: 0,
  }

  const kinds = claimableKinds(env)
  if (kinds.length < JOB_KINDS.length) {
    log.warn("jobs.kinds_paused", {
      requestId: options.requestId,
      jobsEnabled: env.JOBS_ENABLED,
      publishEnabled: env.PUBLISH_ENABLED,
      syncEnabled: env.SYNC_ENABLED,
      claiming: kinds,
    })
  }
  if (kinds.length === 0) return summary

  await reclaimExpired()

  const deadline = Date.now() + Math.max(0, options.budgetMs)
  const tick: Tick = { requestId: options.requestId, summary }

  // The lease must outlive the slowest item in a batch. Google calls are
  // bounded by GOOGLE_TIMEOUT_MS and a checkpoint runs up to five pages, so
  // the tick budget plus a margin is the right ceiling.
  const leaseSeconds = Math.ceil(options.budgetMs / 1000) + 60

  // Stop claiming once there is not even one provider call's worth of budget
  // left: a claimed row that never runs is stranded until its lease expires,
  // which is the whole reason a killed tick used to look like a failure.
  while (Date.now() + env.GOOGLE_TIMEOUT_MS <= deadline) {
    const batch = await claimBatch({
      limit: env.JOBS_BATCH_SIZE,
      leaseSeconds,
      perOrganisation: env.JOBS_PER_ORGANISATION,
      kinds,
    })
    if (batch.length === 0) break
    await runPool(batch, env.JOBS_CONCURRENCY, deadline, (job) =>
      runJob(job, tick)
    )
  }

  return summary
}
