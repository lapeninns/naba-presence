import "server-only"

import { randomUUID } from "node:crypto"

import type { TransactionSql } from "postgres"
import { z } from "zod"

import {
  buildTopicPrompt,
  parseTopicAnswer,
  TOPIC_ANSWER_JSON_SCHEMA,
  type TopicLabel,
} from "@/lib/domain/review-topics"
import { AiOutputError, openAiStructured, type AiUsage } from "@/lib/server/ai"
import {
  backstopWouldBeExceeded,
  readCreditLedger,
  releaseReservation,
  settleReservation,
  type Tenant,
} from "@/lib/server/ai-credits"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import { isOrgFeatureEnabled } from "@/lib/server/org-features"

/**
 * The review-topic classifier (S3). The job tick (lib/server/jobs.ts
 * runDueJobs) calls runReviewTopicClassification once per tick, held by the
 * runner's switch and the operator's AI switch (`drafts`, DRAFTS_ENABLED).
 *
 * For each organisation with reviews waiting (review_topic_due_organisations,
 * 0153, redefined in 0156 to skip restricted reviews), up to
 * REVIEW_TOPIC_MAX_PER_RUN reviews are classified per run,
 * REVIEW_TOPIC_BATCH_SIZE to a model call; the
 * backfill of older reviews drains over successive ticks the same way.
 *
 * One batch is three steps, like a reply draft (lib/server/review-drafts.ts):
 * 1. one tenant transaction checks the organisation's AI access and token
 *    backstop under its ledger lock, claims the batch (a lease on
 *    review_topic_classification) and reserves the call in ai_usage
 *    (kind 'classify', no draft credit);
 * 2. the model call, outside any transaction;
 * 3. one tenant transaction stores the answers for reviews whose text has
 *    not changed since the claim, then the reservation is settled with the
 *    provider's token counts, or released when no call was billed.
 *
 * Only the review text and star rating are sent. Review text is never
 * logged. An unusable answer for a review is never stored: the review's
 * attempts go up and it is tried again on a later tick, up to
 * REVIEW_TOPIC_MAX_ATTEMPTS.
 */

export const REVIEW_TOPIC_BATCH_SIZE = 10
export const REVIEW_TOPIC_MAX_PER_RUN = 30
export const REVIEW_TOPIC_MAX_ATTEMPTS = 3
export const REVIEW_TOPIC_ORGANISATIONS_PER_TICK = 20
export const REVIEW_TOPIC_USAGE_KIND = "classify"

/** A model call starts only with this much of the tick left. */
const MIN_CALL_MS = 10_000

export type ReviewTopicTickSummary = {
  organisations: number
  classified: number
  failed: number
  calls: number
  /** Why the tick did nothing, when it did nothing on purpose. */
  skipped?: "ai_not_configured"
}

export type OrganisationOutcome = {
  classified: number
  failed: number
  calls: number
  /** Why the organisation's run stopped before its limit. */
  stopped:
    | null
    | "nothing_due"
    | "feature_off"
    | "ai_unavailable"
    | "backstop"
    | "provider_error"
    | "no_time"
}

type Claimed = { reviewId: string; text: string; stars: number | null }

type Batch =
  | { kind: "refused"; reason: "feature_off" | "ai_unavailable" | "backstop" }
  | { kind: "empty" }
  | { kind: "claimed"; claimId: string; reservationId: string; rows: Claimed[] }

const answerValidator = z.object({ results: z.array(z.unknown()) })

const pendingPredicate = (sql: TransactionSql, maxAttempts: number) => sql`
  r.review_text is not null
  and btrim(r.review_text) <> ''
  and r.provider_deleted_at is null
  and r.erased_at is null
  -- A fulfilled restriction request (app/api/privacy/requests) keeps the
  -- text but stops its processing: it is never sent to the provider.
  and r.restricted_at is null
  and (c.lease_expires_at is null or c.lease_expires_at < now())
  and (
    c.review_id is null
    or c.text_hash <> md5(r.review_text)
    or (c.status <> 'classified' and c.attempts < ${maxAttempts})
  )
`

/**
 * Step one. Refuses without writing anything when the organisation has the
 * review_topics feature off, may not use AI (read-only billing) or one more
 * call could pass its token backstop; otherwise claims up to `limit` reviews, newest first, and
 * reserves the call. A restricted review is never claimed; one restricted
 * between the claim and the read of its text is handed back unsent.
 */
export async function claimBatch(
  sql: TransactionSql,
  input: {
    organisationId: string
    limit: number
    leaseSeconds: number
    model: string
    /** Reviews this run already sent: an unusable answer waits for a later run. */
    exclude?: readonly string[]
  }
): Promise<Batch> {
  if (
    !(await isOrgFeatureEnabled(sql, input.organisationId, "review_topics"))
  ) {
    return { kind: "refused", reason: "feature_off" }
  }
  const ledger = await readCreditLedger(sql, input.organisationId, {
    lock: true,
  })
  if (!ledger.access.canUseAi)
    return { kind: "refused", reason: "ai_unavailable" }
  if (backstopWouldBeExceeded(ledger)) {
    return { kind: "refused", reason: "backstop" }
  }
  const claimId = randomUUID()
  const claimed = await sql<{ reviewId: string }[]>`
    with candidates as (
      select r.id, md5(r.review_text) as text_hash, r.update_time
      from review r
      left join review_topic_classification c on c.review_id = r.id
      where r.organisation_id = ${input.organisationId}
        and ${pendingPredicate(sql, REVIEW_TOPIC_MAX_ATTEMPTS)}
        and r.id <> all(${input.exclude ?? []}::uuid[])
      order by r.create_time desc, r.id
      limit ${input.limit}
    )
    insert into review_topic_classification (
      organisation_id, review_id, status, text_hash, attempts, claim_id,
      lease_expires_at, review_update_time
    )
    select
      ${input.organisationId}, id, 'pending', text_hash, 0, ${claimId},
      now() + make_interval(secs => ${input.leaseSeconds}), update_time
    from candidates
    on conflict (review_id) do update
    set
      status = 'pending',
      -- An edited text starts its attempts again.
      attempts = case
        when review_topic_classification.text_hash = excluded.text_hash
          then review_topic_classification.attempts
        else 0
      end,
      text_hash = excluded.text_hash,
      claim_id = excluded.claim_id,
      lease_expires_at = excluded.lease_expires_at,
      review_update_time = excluded.review_update_time,
      updated_at = now()
    -- Re-checked on the row: a concurrent run that claimed it first holds a
    -- live lease.
    -- and a run that stored an answer for the same text in the meantime
    -- is not undone.
    where (
        review_topic_classification.lease_expires_at is null
        or review_topic_classification.lease_expires_at < now()
      )
      and (
        review_topic_classification.status <> 'classified'
        or review_topic_classification.text_hash <> excluded.text_hash
      )
    returning review_id::text as "reviewId"
  `
  if (claimed.length === 0) return { kind: "empty" }
  const rows = await sql<Claimed[]>`
    select r.id::text as "reviewId", r.review_text as text, r.star_rating as stars
    from review r
    join review_topic_classification c on c.review_id = r.id
    where c.claim_id = ${claimId}
      -- Restricted since the claim was taken: never sent.
      and r.restricted_at is null
    order by r.create_time desc, r.id
  `
  if (rows.length < claimed.length) {
    await sql`
      update review_topic_classification
      set claim_id = null, lease_expires_at = null, updated_at = now()
      where claim_id = ${claimId}
        and review_id <> all(${rows.map((row) => row.reviewId)}::uuid[])
    `
    if (rows.length === 0) return { kind: "empty" }
  }
  const [reservation] = await sql<{ id: string }[]>`
    insert into ai_usage (
      organisation_id, kind, status, credits, model,
      review_id, draft_id, request_id, user_id, period_start, credit_period_id
    )
    values (
      ${input.organisationId}, ${REVIEW_TOPIC_USAGE_KIND}, 'reserved', 0,
      ${input.model}, null, null, ${`topics:${claimId}`}, null,
      (date_trunc('month', now() at time zone 'utc'))::date,
      ${ledger.period?.id ?? null}
    )
    returning id::text as id
  `
  return { kind: "claimed", claimId, reservationId: reservation.id, rows }
}

/**
 * Step three. Stores each usable answer whose review still carries the text
 * that was claimed (an edit in the meantime leaves it for the next run),
 * replacing the review's earlier labels. A review without a usable answer
 * counts one more attempt; at the limit its earlier labels, which belong to
 * a text it no longer has, are removed.
 */
export async function storeAnswers(
  sql: TransactionSql,
  input: {
    organisationId: string
    claimId: string
    model: string
    answers: Map<string, TopicLabel[]>
  }
): Promise<{ classified: number; failed: number }> {
  const current = await sql<{ reviewId: string; updateTime: Date }[]>`
    select r.id::text as "reviewId", r.update_time as "updateTime"
    from review_topic_classification c
    join review r on r.id = c.review_id
    where c.claim_id = ${input.claimId}
      and r.review_text is not null
      and c.text_hash = md5(r.review_text)
    for update of c
  `
  let classified = 0
  for (const row of current) {
    const labels = input.answers.get(row.reviewId)
    if (!labels) continue
    await sql`delete from review_topic where review_id = ${row.reviewId}`
    if (labels.length > 0) {
      await sql`
        insert into review_topic ${sql(
          labels.map((label) => ({
            organisation_id: input.organisationId,
            review_id: row.reviewId,
            topic: label.topic,
            sentiment: label.sentiment,
            model: input.model,
            classified_at: new Date(),
            review_update_time: row.updateTime,
          }))
        )}
      `
    }
    await sql`
      update review_topic_classification
      set status = 'classified', attempts = 0, model = ${input.model},
        classified_at = now(), review_update_time = ${row.updateTime},
        claim_id = null, lease_expires_at = null, updated_at = now()
      where review_id = ${row.reviewId}
    `
    classified += 1
  }
  const failed = await markUnusable(sql, input.claimId)
  // Claims whose text changed since: handed back untouched.
  await releaseClaim(sql, input.claimId)
  return { classified, failed }
}

/** Answers the model got wrong: one more attempt each. */
async function markUnusable(sql: TransactionSql, claimId: string) {
  const failed = await sql<{ reviewId: string; attempts: number }[]>`
    update review_topic_classification c
    set status = 'failed', attempts = c.attempts + 1, claim_id = null,
      lease_expires_at = null, updated_at = now()
    from review r
    where c.claim_id = ${claimId}
      and r.id = c.review_id
      and r.review_text is not null
      and c.text_hash = md5(r.review_text)
    returning c.review_id::text as "reviewId", c.attempts
  `
  const exhausted = failed
    .filter((row) => row.attempts >= REVIEW_TOPIC_MAX_ATTEMPTS)
    .map((row) => row.reviewId)
  if (exhausted.length > 0) {
    await sql`delete from review_topic where review_id in ${sql(exhausted)}`
  }
  return failed.length
}

/** Hands a claim back without counting an attempt. */
async function releaseClaim(sql: TransactionSql, claimId: string) {
  await sql`
    update review_topic_classification
    set claim_id = null, lease_expires_at = null, updated_at = now()
    where claim_id = ${claimId}
  `
}

export type TopicClassifier = (
  prompt: string,
  options: { deadline: number }
) => Promise<{ value: unknown; usage: AiUsage }>

/**
 * Kept back from the model call for storing the answers and settling the
 * call, as a reply draft keeps its phase three (lib/server/review-drafts.ts).
 */
const STORE_RESERVE_MS = 5_000

/** The configured provider, through the shared structured-output call. */
export const openAiTopicClassifier: TopicClassifier = (prompt, { deadline }) =>
  openAiStructured(
    getServerEnv().OPENAI_MODEL_VERIFY,
    "review_topics",
    TOPIC_ANSWER_JSON_SCHEMA,
    prompt,
    answerValidator,
    { deadline, reserveMs: STORE_RESERVE_MS }
  )

/**
 * Classifies up to `maxReviews` waiting reviews of one organisation. Stops
 * early, keeping what was stored, when AI is unavailable to it, at the
 * backstop, on a provider failure (the batch is handed back untouched) or
 * when the tick has no time for another call.
 */
export async function classifyOrganisationReviews(
  organisationId: string,
  options: {
    deadline: number
    leaseSeconds: number
    maxReviews?: number
    classifier?: TopicClassifier
  }
): Promise<OrganisationOutcome> {
  const model = getServerEnv().OPENAI_MODEL_VERIFY
  const classifier = options.classifier ?? openAiTopicClassifier
  const tenant: Tenant = (fn) => withTenant(organisationId, fn)
  const outcome: OrganisationOutcome = {
    classified: 0,
    failed: 0,
    calls: 0,
    stopped: null,
  }
  let left = options.maxReviews ?? REVIEW_TOPIC_MAX_PER_RUN
  const sent: string[] = []
  while (left > 0) {
    if (Date.now() + MIN_CALL_MS > options.deadline) {
      outcome.stopped = "no_time"
      break
    }
    const batch = await tenant((sql) =>
      claimBatch(sql, {
        organisationId,
        limit: Math.min(REVIEW_TOPIC_BATCH_SIZE, left),
        exclude: sent,
        leaseSeconds: options.leaseSeconds,
        model,
      })
    )
    if (batch.kind === "refused") {
      outcome.stopped = batch.reason
      break
    }
    if (batch.kind === "empty") {
      outcome.stopped = "nothing_due"
      break
    }
    left -= batch.rows.length
    sent.push(...batch.rows.map((row) => row.reviewId))
    outcome.calls += 1
    let value: unknown
    let usage: AiUsage
    try {
      ;({ value, usage } = await classifier(
        buildTopicPrompt(
          batch.rows.map((row) => ({ text: row.text, stars: row.stars }))
        ),
        { deadline: options.deadline }
      ))
    } catch (error) {
      if (error instanceof AiOutputError) {
        // Billed but unusable: every review in the batch counts an attempt.
        // The call is settled whatever happens to the bookkeeping.
        try {
          outcome.failed += await tenant(async (sql) => {
            const failed = await markUnusable(sql, batch.claimId)
            // Claims whose text changed since: handed back untouched.
            await releaseClaim(sql, batch.claimId)
            return failed
          })
        } finally {
          await settleReservation(
            tenant,
            { id: batch.reservationId, usage: error.usage, model },
            "review_topics.usage_record_failed"
          )
        }
        continue
      }
      // Nothing was billed: the reservation goes back whatever happens to
      // the claim, which its lease releases in any case.
      try {
        await tenant((sql) => releaseClaim(sql, batch.claimId))
      } finally {
        await releaseReservation(
          tenant,
          { id: batch.reservationId },
          "review_topics.usage_record_failed"
        )
      }
      log.warn("review_topics.provider_failed", {
        organisationId,
        code: error instanceof ApiError ? error.code : "unknown",
      })
      outcome.stopped = "provider_error"
      break
    }
    const parsed = parseTopicAnswer(value, batch.rows.length)
    const answers = new Map<string, TopicLabel[]>()
    for (const [index, row] of batch.rows.entries()) {
      const labels = parsed.get(index + 1)
      if (labels) answers.set(row.reviewId, labels)
    }
    try {
      const stored = await tenant((sql) =>
        storeAnswers(sql, {
          organisationId,
          claimId: batch.claimId,
          model,
          answers,
        })
      )
      outcome.classified += stored.classified
      outcome.failed += stored.failed
    } finally {
      // The call was made and billed whatever happened to the store.
      await settleReservation(
        tenant,
        { id: batch.reservationId, usage, model },
        "review_topics.usage_record_failed"
      )
    }
  }
  return outcome
}

/** One tick's classification across organisations. Never throws. */
export async function runReviewTopicClassification(options: {
  budgetMs: number
  requestId: string
  classifier?: TopicClassifier
}): Promise<ReviewTopicTickSummary> {
  const summary: ReviewTopicTickSummary = {
    organisations: 0,
    classified: 0,
    failed: 0,
    calls: 0,
  }
  if (!options.classifier && !getServerEnv().OPENAI_API_KEY) {
    return { ...summary, skipped: "ai_not_configured" }
  }
  const deadline = Date.now() + Math.max(0, options.budgetMs)
  const leaseSeconds = Math.ceil(options.budgetMs / 1000) + 60
  if (Date.now() + MIN_CALL_MS > deadline) return summary
  const due = await getDatabase()<{ organisationId: string }[]>`
    select organisation_id::text as "organisationId"
    from review_topic_due_organisations(
      ${REVIEW_TOPIC_ORGANISATIONS_PER_TICK},
      ${REVIEW_TOPIC_MAX_ATTEMPTS}
    )
  `
  for (const { organisationId } of due) {
    if (Date.now() + MIN_CALL_MS > deadline) break
    try {
      const outcome = await classifyOrganisationReviews(organisationId, {
        deadline,
        leaseSeconds,
        classifier: options.classifier,
      })
      summary.organisations += 1
      summary.classified += outcome.classified
      summary.failed += outcome.failed
      summary.calls += outcome.calls
      // A provider outage is the same for every organisation.
      if (outcome.stopped === "provider_error") break
    } catch (error) {
      log.error("review_topics.organisation_failed", {
        requestId: options.requestId,
        organisationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return summary
}
