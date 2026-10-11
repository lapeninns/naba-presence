import "server-only"

import type { Fragment, TransactionSql } from "postgres"

import { purgeAbuseRateBuckets } from "@/lib/server/abuse-limits"
import { writeAudit } from "@/lib/server/audit"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import { settleInterruptedListingChanges } from "@/lib/server/listing-changes"
import { settleOperationsForAttempts } from "@/lib/server/mutation-operations"
import { requireScopesEnabled } from "@/lib/server/pause-controls"
import { reapStrandedLocalPosts } from "@/lib/server/posts"

/** Rows one dataset statement may change in one transaction, by default. */
export const RETENTION_BATCH_ROWS_DEFAULT = 500

/**
 * The per-statement row bound, from RETENTION_BATCH_ROWS (read straight from
 * process.env like RETENTION_BUDGET_MS). Each dataset statement changes at
 * most this many rows per transaction, so one transaction touches at most
 * this many rows per dataset however far behind a tenant is.
 */
export function retentionBatchRows(): number {
  const configured = Number(process.env.RETENTION_BATCH_ROWS)
  return Number.isInteger(configured) && configured >= 1 && configured <= 10_000
    ? configured
    : RETENTION_BATCH_ROWS_DEFAULT
}

/**
 * One dataset of the purge. `run` changes at most `limit` rows and returns
 * how many it changed; a step that changed fewer than `limit` has caught up
 * and does not run again in this purge. A `destructive` step answers to
 * RETENTION_DELETES_ENABLED: the irreversible half of retention has its own
 * kill switch, so an operator can stop deleting during an incident while
 * redaction of expired provider content keeps running for the obligation it
 * exists to meet. A `once` step runs a single time per purge: it reaps
 * in-flight state, which is bounded by live work rather than by history.
 */
type PurgeStep = {
  key: string
  destructive?: boolean
  once?: boolean
  run: (sql: TransactionSql, limit: number) => Promise<number>
}

/**
 * Deletes, or updates with `set`, at most `limit` rows of `table` matching
 * `where`, and returns their ids. The candidate rows are chosen first and the
 * predicate is checked again on the statement itself, so a row a concurrent
 * write moved out of scope in between (a review re-ingested with a fresh
 * expiry, say) is left alone: under READ COMMITTED the outer predicate is
 * re-evaluated against the row's latest version. No row locks are taken:
 * `for update` needs UPDATE on append-only audit_log, and retention is the
 * single writer of its own predicates under the `naba:retention` lease.
 */
async function boundedRows(
  sql: TransactionSql,
  {
    table,
    where,
    set,
    limit,
  }: {
    table: string
    where: () => Fragment
    set?: () => Fragment
    limit: number
  }
): Promise<string[]> {
  const target = sql(table)
  const rows = set
    ? await sql<{ id: string }[]>`
        with doomed as (
          select id from ${target} where ${where()} limit ${limit}
        )
        update ${target} set ${set()}
        where id in (select id from doomed) and ${where()}
        returning id::text as id
      `
    : await sql<{ id: string }[]>`
        with doomed as (
          select id from ${target} where ${where()} limit ${limit}
        )
        delete from ${target}
        where id in (select id from doomed) and ${where()}
        returning id::text as id
      `
  return rows.map((row) => row.id)
}

/** A bounded statement as a step that reports its row count. */
function rowsStep(
  key: string,
  options: {
    table: string
    where: (sql: TransactionSql) => Fragment
    set?: (sql: TransactionSql) => Fragment
    destructive?: boolean
  }
): PurgeStep {
  return {
    key,
    destructive: options.destructive,
    run: async (sql, limit) =>
      (
        await boundedRows(sql, {
          table: options.table,
          where: () => options.where(sql),
          set: options.set ? () => options.set!(sql) : undefined,
          limit,
        })
      ).length,
  }
}

type StrandedAttemptTable =
  | "hours_sync_attempt"
  | "profile_sync_attempt"
  | "food_menus_sync_attempt"
  | "gbp_media_mutation"
  | "place_action_mutation"
  | "gbp_management_mutation"

/**
 * Ages an attempt row a request left in flight to 'ambiguous' and, in the
 * same transaction, settles the receipts linked to it
 * (lib/server/mutation-operations.ts): left `sent`, GET /api/mutations/{id}
 * would keep reporting a write in flight that is now of unknown outcome.
 * Settled `uncertain`, they are due for recovery at once (job kind
 * `mutation_recover`, lib/server/mutation-recovery.ts), which reads Google
 * back and settles the receipt and its row: the aging only hands the row to
 * recovery, it is no longer where the row ends.
 */
function strandedStep(
  key: string,
  attemptTable: StrandedAttemptTable,
  {
    inFlight,
    errorColumn,
  }: { inFlight: readonly string[]; errorColumn: string }
): PurgeStep {
  return {
    key,
    run: async (sql, limit) => {
      const ids = await boundedRows(sql, {
        table: attemptTable,
        where: () => sql`
          status in ${sql(inFlight as string[])}
          and started_at <= now() - interval '24 hours'
        `,
        set: () => sql`
          status = 'ambiguous', ${sql(errorColumn)} = 'attempt_interrupted',
          finished_at = now()
        `,
        limit,
      })
      await settleOperationsForAttempts(sql, {
        attemptTable,
        attemptIds: ids,
        state: "uncertain",
        attemptStatus: "ambiguous",
        errorCode: "attempt_interrupted",
        // A day past the start: nothing is still applying.
        recoverAfterSeconds: 0,
      })
      return ids.length
    },
  }
}

/**
 * Every dataset the purge retains, in the order each round runs them. The
 * predicates are the retention rules; each runs bounded (see boundedRows).
 */
function purgeSteps(organisationId: string): PurgeStep[] {
  return [
    rowsStep("auditLogs", {
      destructive: true,
      table: "audit_log",
      where: (sql) => sql`
        created_at < now() - make_interval(
          days => (
            select audit_retention_days
            from organisation
            where id = ${organisationId}
          )
        )
      `,
    }),
    rowsStep("media", {
      destructive: true,
      table: "review_media_item",
      where: (sql) => sql`
        exists (
          select 1 from review r
          where r.id = review_media_item.review_id
            and r.raw_content_expires_at <= now()
            and not exists (
              select 1 from legal_hold h
              where h.review_id = r.id
                and h.released_at is null
            )
        )
      `,
    }),
    rowsStep("reviews", {
      table: "review",
      where: (sql) => sql`
        raw_content_expires_at <= now()
        and not exists (
          select 1 from legal_hold h
          where h.review_id = review.id
            and h.released_at is null
        )
        and (
          review_text is not null
          or reviewer_display_name is not null
          or raw_payload is not null
        )
      `,
      set: (sql) => sql`
        review_text = null,
        reviewer_display_name = null,
        raw_payload = null
      `,
    }),
    rowsStep("accounts", {
      table: "google_account",
      where: (sql) => sql`
        raw_content_expires_at <= now()
        and raw_payload is not null
      `,
      set: (sql) => sql`raw_payload = null`,
    }),
    rowsStep("locations", {
      table: "external_location",
      where: (sql) => sql`
        raw_content_expires_at <= now()
        and (raw_payload is not null or address_json is not null)
      `,
      set: (sql) => sql`raw_payload = null, address_json = null`,
    }),
    // review -> external_location and legal_hold -> review are both ON
    // DELETE CASCADE (0001), so without the hold predicate the purge would
    // destroy held reviews and the holds protecting them in one statement.
    rowsStep("disconnectedLocations", {
      destructive: true,
      table: "external_location",
      where: (sql) => sql`
        google_connection_id in (
          select id from google_connection
          where status = 'disconnected'
            and purge_due_at <= now()
        )
        and not exists (
          select 1 from review r
          join legal_hold h
            on h.review_id = r.id and h.released_at is null
          where r.external_location_id = external_location.id
        )
      `,
    }),
    // A one-time reaper, not an ongoing obligation: the Pub/Sub route no
    // longer writes `payload` or `payload_expires_at`, so this only ages out
    // rows written before that change. It can be deleted once the oldest of
    // them has passed its 30-day expiry.
    rowsStep("webhookPayloads", {
      table: "processed_webhook_event",
      where: (sql) => sql`
        payload_expires_at <= now()
        and payload is not null
      `,
      set: (sql) => sql`payload = null`,
    }),
    rowsStep("hoursAttempts", {
      destructive: true,
      table: "hours_sync_attempt",
      where: (sql) => sql`expires_at <= now()`,
    }),
    rowsStep("keywordHistory", {
      destructive: true,
      table: "performance_search_keyword_monthly",
      where: (sql) => sql`
        metric_month < date_trunc('month', now()) - interval '18 months'
      `,
    }),
    rowsStep("placeActionMutations", {
      destructive: true,
      table: "place_action_mutation",
      where: (sql) => sql`expires_at <= now()`,
    }),
    // An uncertain create nobody has resolved yet is kept past its expiry:
    // it blocks a re-create of the same content and holds what a person
    // needs to decide (lib/server/media.ts `unresolvedCreate`). It ages off
    // once resolved, since resolving leaves expires_at as is.
    rowsStep("mediaMutations", {
      destructive: true,
      table: "gbp_media_mutation",
      where: (sql) => sql`
        expires_at <= now()
        and not (
          operation = 'create'
          and resolution is null
          and (
            status = 'needs_resolution'
            or (status = 'ambiguous' and upload_phase = 'create_sent')
          )
        )
      `,
    }),
    rowsStep("managementMutations", {
      destructive: true,
      table: "gbp_management_mutation",
      where: (sql) => sql`expires_at <= now()`,
    }),
    rowsStep("onboardingDrafts", {
      destructive: true,
      table: "google_onboarding_draft",
      where: (sql) => sql`expires_at <= now()`,
    }),
    // A reviewed Place Action attempt outlives its review (it is written
    // later) and restricts deletion, so the review waits for it.
    rowsStep("managementChangeSets", {
      destructive: true,
      table: "gbp_change_set",
      where: (sql) => sql`
        expires_at <= now()
        and not exists (
          select 1 from place_action_mutation m
          where m.change_set_id = gbp_change_set.id
        )
      `,
    }),
    // The snapshot is a cache keyed per resource and rebuilt on the next
    // read, and payload is jsonb NOT NULL, so it is deleted rather than
    // nulled out the way the sibling payload columns are.
    rowsStep("resourceSnapshots", {
      destructive: true,
      table: "gbp_resource_snapshot",
      where: (sql) => sql`expires_at <= now()`,
    }),
    // snapshot_expires_at is NOT NULL (0016) and is reset on every
    // observation, so leave it in place; the value guard keeps the purge
    // idempotent for rows that have already been cleared.
    rowsStep("profileSnapshots", {
      table: "profile_field_state",
      where: (sql) => sql`
        snapshot_expires_at <= now()
        and (canonical_value is not null or google_value is not null)
      `,
      set: (sql) => sql`canonical_value = null, google_value = null`,
    }),
    rowsStep("profileAttempts", {
      destructive: true,
      table: "profile_sync_attempt",
      where: (sql) => sql`expires_at <= now()`,
    }),
    rowsStep("postPayloads", {
      table: "gbp_local_post",
      where: (sql) => sql`
        provider_payload_expires_at <= now()
        and provider_payload is not null
      `,
      set: (sql) => sql`
        provider_payload = null, provider_payload_expires_at = null
      `,
    }),
    rowsStep("postAttempts", {
      destructive: true,
      table: "gbp_local_post_attempt",
      where: (sql) => sql`expires_at <= now()`,
    }),
    // payload_expires_at is NOT NULL (0022) and is reset on every
    // observation, so leave it in place exactly as profile_field_state above
    // does; the value guard keeps the purge idempotent.
    rowsStep("googleMediaPayloads", {
      table: "gbp_media_item",
      where: (sql) => sql`
        payload_expires_at <= now()
        and (
          source_url is not null
          or google_url is not null
          or thumbnail_url is not null
          or description is not null
          or attribution is not null
          or dimensions is not null
          or insights is not null
        )
      `,
      set: (sql) => sql`
        source_url = null, google_url = null, thumbnail_url = null,
        description = null, attribution = null, dimensions = null,
        insights = null
      `,
    }),
    rowsStep("foodMenuStates", {
      destructive: true,
      table: "food_menus_state",
      where: (sql) => sql`expires_at <= now()`,
    }),
    rowsStep("foodMenuAttempts", {
      destructive: true,
      table: "food_menus_sync_attempt",
      where: (sql) => sql`expires_at <= now()`,
    }),
    rowsStep("importProposals", {
      destructive: true,
      table: "presence_import_proposal",
      where: (sql) => sql`expires_at <= now()`,
    }),
    // Sign-out and organisation switch are the only other deleters, so
    // without this a dead session row (with its token hash and any
    // impersonation reason) outlives the audit trail above it. RLS scopes
    // the statement to this tenant via session_isolation (0001).
    rowsStep("appSessions", {
      destructive: true,
      table: "app_session",
      where: (sql) => sql`expires_at < now() - interval '7 days'`,
    }),
    // Rows an interrupted publish left claiming to be publishing. The reaper
    // is here rather than in the module because every user-facing path
    // already reclaims the location's rows before listing; this is for the
    // tenant nobody opens.
    {
      key: "strandedPosts",
      once: true,
      run: async (sql) => (await reapStrandedLocalPosts(sql)).count,
    },
    // The same shape one level up, for the GBP write surfaces. runGbpWrite
    // recovers an in-flight row by readback on the next request for the
    // SAME key, so this only reaches rows nothing will ever revisit: the
    // write landed, the snapshot moved, and the next publish derives a
    // different key. Twenty-four hours is far past the two-minute in-flight
    // grace, so the readback path still owns every fresh row; past it a
    // settled 'ambiguous' row is read back on its next same-key request --
    // settled from what Google holds before anything re-arms -- and a
    // surface with no readback answers 409 mutation_uncertain rather than
    // sending the write a second time.
    //
    // All THREE in-flight statuses, not just 'publishing': hours and profile
    // issue a validateOnly call to Google during 'validating', outside any
    // transaction, so an interrupted request strands there just as readily.
    // ('validated' never occurs on food menus -- its CHECK omits the value
    // -- so the predicate simply does not match.)
    strandedStep("strandedHours", "hours_sync_attempt", {
      inFlight: ["validating", "validated", "publishing"],
      errorColumn: "provider_error_code",
    }),
    strandedStep("strandedProfiles", "profile_sync_attempt", {
      inFlight: ["validating", "validated", "publishing"],
      errorColumn: "provider_error_code",
    }),
    strandedStep("strandedFoodMenus", "food_menus_sync_attempt", {
      inFlight: ["validating", "validated", "publishing"],
      errorColumn: "last_error_code",
    }),
    // The remaining three surfaces map every in-flight phase onto 'started'
    // (their CHECK admits no finer vocabulary; gbp_management also has
    // 'validated'). All three carry started_at (place actions from the
    // start, gbp_management from 0088, media from 0093), which a re-arm
    // resets. A media create aged here keeps its upload_phase: recovery
    // fails one that never reached create_sent and matches one that did
    // against the live list, or hands it to a person.
    strandedStep("strandedMedia", "gbp_media_mutation", {
      inFlight: ["started"],
      errorColumn: "last_error_code",
    }),
    strandedStep("strandedPlaceActions", "place_action_mutation", {
      inFlight: ["started"],
      errorColumn: "last_error_code",
    }),
    strandedStep("strandedManagement", "gbp_management_mutation", {
      inFlight: ["started", "validated"],
      errorColumn: "last_error_code",
    }),
    // Approved listing change requests whose dispatch never claimed an
    // attempt (lib/server/listing-changes.ts): nothing was sent for them,
    // and left `sent` they would read as in flight for good.
    {
      key: "interruptedApprovals",
      once: true,
      run: (sql) => settleInterruptedListingChanges(sql, { organisationId }),
    },
  ]
}

export type OrganisationPurgeCounts = Record<string, number>

export type OrganisationPurgeInput = {
  organisationId: string
  requestId: string
  clientRequestId: string | null
  deletesEnabled: boolean
  /**
   * When this run must stop. The purge always finishes at least one round,
   * so every run makes progress, and stops between rounds once it has passed.
   */
  deadline: number
  /**
   * What earlier runs of this organisation in the same cycle already
   * committed. The completion audit reports the organisation's totals.
   */
  priorCounts?: OrganisationPurgeCounts
  /** Called after each committed round with that round's nonzero counts. */
  onProgress?: (counts: OrganisationPurgeCounts) => Promise<void>
}

export type OrganisationPurgeResult = {
  /**
   * False when the deadline stopped the purge with rows still due: what it
   * committed stays committed, and the next run carries on from there.
   */
  complete: boolean
  /** Rows this run changed, per dataset, plus heldLocationsSkipped. */
  counts: OrganisationPurgeCounts
  /** Transactions this run committed. */
  rounds: number
}

function addCounts(
  into: OrganisationPurgeCounts,
  ...from: readonly OrganisationPurgeCounts[]
): OrganisationPurgeCounts {
  for (const counts of from) {
    for (const [key, value] of Object.entries(counts)) {
      into[key] = (into[key] ?? 0) + value
    }
  }
  return into
}

function nonzero(counts: OrganisationPurgeCounts): OrganisationPurgeCounts {
  return Object.fromEntries(
    Object.entries(counts).filter(([, value]) => value !== 0)
  )
}

/**
 * Retains one organisation in bounded rounds (plan P04-2). Each round is one
 * tenant transaction that runs every dataset still behind, each changing at
 * most RETENTION_BATCH_ROWS rows; a dataset that changed fewer has caught
 * up. Rounds repeat until every dataset has caught up or the deadline passes,
 * so a tenant with a backlog no longer runs one unbounded transaction that a
 * time limit rolls back whole and that then fails identically every day.
 * Every statement's predicate excludes the rows it already handled, so a
 * later run (the next dispatcher fire, or a hand page) resumes simply by
 * running again.
 *
 * The round that finds everything caught up also counts locations held back
 * from a disconnected purge and writes the `retention.purge.completed` audit,
 * with the organisation's totals across the cycle (`priorCounts` plus this
 * run), when anything changed. Both the cycle dispatcher
 * (lib/server/retention/cycle.ts) and a hand-run page (`retainPage`) call it,
 * so the two can never retain differently.
 *
 * The caller reads the pause table and the deletion switch before calling,
 * outside the tenant transaction; nothing here reads platform state.
 */
export async function purgeOrganisation({
  organisationId,
  requestId,
  clientRequestId,
  deletesEnabled,
  deadline,
  priorCounts = {},
  onProgress,
}: OrganisationPurgeInput): Promise<OrganisationPurgeResult> {
  const limit = retentionBatchRows()
  const steps = purgeSteps(organisationId)
  const counts: OrganisationPurgeCounts = Object.fromEntries(
    steps.map((step) => [step.key, 0])
  )
  let pending = steps.filter((step) => deletesEnabled || !step.destructive)
  let rounds = 0
  let heldLocationsSkipped = 0
  for (;;) {
    const round = await withTenant(organisationId, async (sql) => {
      await sql`
        select set_config('app.retention_run', 'true', true)
      `
      const changed: OrganisationPurgeCounts = {}
      const behind: PurgeStep[] = []
      for (const step of pending) {
        const rows = await step.run(sql, limit)
        changed[step.key] = rows
        if (!step.once && rows >= limit) behind.push(step)
      }
      if (behind.length) return { changed, behind, held: 0 }
      // A held location keeps its connection past the seven-day promise
      // forever, so report it rather than letting the purge stall silently.
      const [held] = await sql<{ count: number }[]>`
        select count(*)::int as count
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
      `
      const heldCount = held?.count ?? 0
      const totals = addCounts(
        Object.fromEntries(steps.map((step) => [step.key, 0])),
        priorCounts,
        counts,
        changed
      )
      if (
        Object.values(totals).some((count) => count > 0) ||
        heldCount > 0
      ) {
        await writeAudit(sql, {
          organisationId,
          action: "retention.purge.completed",
          subjectType: "organisation",
          subjectId: organisationId,
          requestId: `${requestId}:${organisationId}`,
          metadata: {
            ...totals,
            heldLocationsSkipped: heldCount,
            deletesEnabled,
            batchRows: limit,
            clientRequestId,
          },
        })
      }
      return { changed, behind, held: heldCount }
    })
    // Counted only once the round has committed, so a rolled-back round
    // never reports rows it did not keep.
    rounds += 1
    addCounts(counts, round.changed)
    pending = round.behind
    heldLocationsSkipped = round.held
    const progressed = nonzero(round.changed)
    if (onProgress && Object.keys(progressed).length) {
      await onProgress(progressed)
    }
    if (!pending.length || Date.now() >= deadline) break
  }
  const complete = pending.length === 0
  log.info(
    complete ? "retention.organisation_purged" : "retention.organisation_partial",
    {
      requestId,
      organisationId,
      rounds,
      behind: pending.map((step) => step.key),
      ...counts,
      heldLocationsSkipped,
    }
  )
  return {
    complete,
    counts: { ...counts, heldLocationsSkipped },
    rounds,
  }
}

export type RetentionFailure = {
  organisationId: string
  errorCode: string
}

/** A stable machine code for a failed organisation; never a message. */
export function retentionErrorCode(error: unknown): string {
  return (error instanceof ApiError ? error.code : "internal_error").slice(0, 64)
}

/**
 * Reads the retention switches once per run, outside any tenant transaction:
 * RETENTION_ENABLED is the hard override and the operator pause table
 * (lib/server/pause-controls.ts) pauses the same scope without a redeploy;
 * RETENTION_DELETES_ENABLED stops only the destructive half.
 */
export async function requireRetentionEnabled(): Promise<{
  deletesEnabled: boolean
}> {
  await requireScopesEnabled("retention", {
    code: "retention_paused",
    message:
      "Retention is paused (RETENTION_ENABLED or an operator pause). Resume the scope to restart the purge.",
  })
  return { deletesEnabled: getServerEnv().RETENTION_DELETES_ENABLED }
}

/**
 * The run's deadline. Stay inside the scheduler's 55s abort and the route's
 * 60s maxDuration so a long run stops between organisations instead of being
 * killed in the middle of one.
 */
export function retentionDeadline(now: number = Date.now()): number {
  const configuredBudget = Number(process.env.RETENTION_BUDGET_MS ?? 45_000)
  return (
    now +
    (Number.isFinite(configuredBudget) && configuredBudget >= 0
      ? configuredBudget
      : 45_000)
  )
}

/**
 * Purges the platform-level abuse-limit windows that have ended (0085). They
 * hold no tenant data, so RETENTION_DELETES_ENABLED (the switch for tenant
 * deletes) does not stop this; leaving them would only grow the table. A
 * failure is logged and the tenant walk goes on: a stale counter only costs
 * space.
 */
export async function purgeEndedAbuseBuckets(
  requestId: string
): Promise<number | null> {
  try {
    return await purgeAbuseRateBuckets()
  } catch (error) {
    log.error("retention.abuse_buckets_failed", { requestId, error })
    return null
  }
}

export type RetentionPageInput = {
  requestId: string
  clientRequestId: string | null
  cursor: string | null
  batchSize: number
}

/**
 * The cursor that restarts a hand-run walk at the head of the fleet. The nil
 * UUID sorts before every organisation id (all are gen_random_uuid), so a
 * page that ran out of budget inside the first organisation can still name a
 * cursor that resumes it; an empty cursor would also purge the ended
 * abuse-limit windows again.
 */
export const RETENTION_HEAD_CURSOR = "00000000-0000-0000-0000-000000000000"

/**
 * One hand-run page of the retention walk: up to `batchSize` organisations
 * after `cursor`, in organisation order. This is the operator's tool for
 * retaining a slice of the fleet now; the scheduled walk is the cycle
 * dispatcher (lib/server/retention/cycle.ts), and a page neither reads nor
 * moves its progress. A page that starts at the head also purges the ended
 * abuse-limit windows, as the cycle does when it opens.
 *
 * An organisation the budget stopped part-way is listed in `partial`, with
 * what it committed, and `nextCursor` points just before it so the next page
 * resumes it.
 */
export async function retainPage({
  requestId,
  clientRequestId,
  cursor,
  batchSize,
}: RetentionPageInput) {
  const { deletesEnabled } = await requireRetentionEnabled()
  const deadline = retentionDeadline()
  // Cross-tenant enumeration: the walk covers every organisation that has a
  // job route, so this one read deliberately runs outside withTenant.
  const database = getDatabase()
  const organisations = await database<{ id: string }[]>`
    select organisation_id::text as id
    from organisation_job_route
    ${cursor ? database`where organisation_id > ${cursor}` : database``}
    order by organisation_id
    limit ${batchSize}
  `
  const abuseRateBuckets = cursor ? null : await purgeEndedAbuseBuckets(requestId)
  const results = []
  const partial = []
  const failures: RetentionFailure[] = []
  let processed = 0
  let budgetExhausted = false
  let lastProcessedOrganisationId: string | null = null
  for (const organisation of organisations) {
    if (processed > 0 && Date.now() >= deadline) {
      budgetExhausted = true
      break
    }
    try {
      const purged = await purgeOrganisation({
        organisationId: organisation.id,
        requestId,
        clientRequestId,
        deletesEnabled,
        deadline,
      })
      if (!purged.complete) {
        partial.push({ organisationId: organisation.id, ...purged.counts })
        budgetExhausted = true
        break
      }
      results.push({ organisationId: organisation.id, ...purged.counts })
    } catch (error) {
      // One tenant's failure must not starve every organisation ordered
      // after it on the page.
      const errorCode = retentionErrorCode(error)
      failures.push({ organisationId: organisation.id, errorCode })
      log.error("retention.organisation_failed", {
        requestId,
        organisationId: organisation.id,
        errorCode,
        error,
      })
    }
    processed += 1
    lastProcessedOrganisationId = organisation.id
  }
  return {
    organisations: results,
    partial,
    failures,
    abuseRateBuckets,
    nextCursor: partial.length
      ? (lastProcessedOrganisationId ?? cursor ?? RETENTION_HEAD_CURSOR)
      : budgetExhausted || organisations.length === batchSize
        ? lastProcessedOrganisationId
        : null,
  }
}
