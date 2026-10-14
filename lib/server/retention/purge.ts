import "server-only"

import type { Fragment, TransactionSql } from "postgres"

import { purgeAbuseRateBuckets } from "@/lib/server/abuse-limits"
import { purgeExpiredStagingAssets } from "@/lib/server/assets"
import { writeAudit } from "@/lib/server/audit"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import { purgeMfaPendingLogins } from "@/lib/server/mfa"
import { settleOperationsForAttempts } from "@/lib/server/mutation-operations"
import { requireScopesEnabled } from "@/lib/server/pause-controls"
import {
  interruptedListingChange,
  settleInterruptedListingChanges,
} from "@/lib/server/listing-changes"
import { reapStrandedLocalPosts, strandedLocalPost } from "@/lib/server/posts"
import type { RetentionTable } from "@/lib/server/retention/inventory"

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

/** What a dry-run count needs to know about the run it predicts. */
type StepContext = { deletesEnabled: boolean }

/** An expression naming a row's external location id. */
type LocationOf = (sql: TransactionSql) => Fragment

/** The row's own external_location_id column. */
const ownLocation: LocationOf = (sql) => sql`external_location_id`

/**
 * One dataset of the purge, on one table of the retention inventory
 * (lib/server/retention/inventory.ts). `run` changes at most `limit` rows
 * and returns how many it changed; a step that changed fewer than `limit`
 * has caught up and does not run again in this purge. A `destructive` step
 * answers to RETENTION_DELETES_ENABLED: the irreversible half of retention
 * has its own kill switch, so an operator can stop deleting during an
 * incident while redaction of expired provider content keeps running for the
 * obligation it exists to meet. A `once` step runs a single time per purge:
 * it reaps in-flight state, which is bounded by live work rather than by
 * history. `kind` says what the step does to its table's rows: `redact` and
 * `delete` are retention, `reap` settles state an interrupted request left
 * in flight.
 *
 * `count` is the dry run (dryRunOrganisation): how many rows `run` would
 * change, by a `select count(*)` on the same predicate and no mutation.
 */
type PurgeStep = {
  key: string
  table: RetentionTable
  kind: "redact" | "delete" | "reap"
  destructive?: boolean
  once?: boolean
  /**
   * A step whose rows the named step must clear first: it stays behind for
   * as long as that step is behind, even when it changed nothing itself.
   */
  waitsFor?: string
  run: (sql: TransactionSql, limit: number) => Promise<number>
  count: (sql: TransactionSql, context: StepContext) => Promise<number>
}

/** `select count(*)` of `table` rows matching `where`. */
async function countRows(
  sql: TransactionSql,
  table: string,
  where: Fragment
): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from ${sql(table)} where ${where}
  `
  return row?.count ?? 0
}

/**
 * True for a row not tied to a review under an unreleased legal hold.
 * `reviewId` is the SQL expression naming the row's review id, as text, for
 * the datasets that refer to a review without a uuid foreign key (audit_log,
 * ai_usage). The review datasets themselves carry their own hold predicate,
 * and a disconnected location its location-level one (locationNotHeld).
 */
function notHeldReview(sql: TransactionSql, reviewId: Fragment): Fragment {
  return sql`
    not exists (
      select 1 from legal_hold h
      where h.review_id::text = ${reviewId}
        and h.released_at is null
    )
  `
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

/**
 * A bounded statement as a step that reports its row count. Its dry-run
 * count uses `where`, or `dryRunWhere` when an earlier step in the same
 * round changes what `where` matches (a parent that waits for its children
 * to go, say): then `dryRunWhere` predicts the rows `where` will match once
 * those steps have run. A step on a table that cascades from
 * external_location names the row's location in `location`, and the dry run
 * leaves out the rows disconnectedLocations deletes before it
 * (notWithDueLocation).
 */
function rowsStep(
  key: string,
  options: {
    table: RetentionTable
    where: (sql: TransactionSql) => Fragment
    dryRunWhere?: (sql: TransactionSql, context: StepContext) => Fragment
    location?: LocationOf
    set?: (sql: TransactionSql) => Fragment
    destructive?: boolean
    waitsFor?: string
  }
): PurgeStep {
  return {
    key,
    table: options.table,
    kind: options.set ? "redact" : "delete",
    destructive: options.destructive,
    waitsFor: options.waitsFor,
    count: (sql, context) =>
      countRows(
        sql,
        options.table,
        sql`${
          options.dryRunWhere
            ? options.dryRunWhere(sql, context)
            : options.where(sql)
        } ${notWithDueLocation(sql, context, options.location)}`
      ),
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
    expired,
    location,
  }: {
    inFlight: readonly string[]
    errorColumn: string
    /** As rowsStep's `location`, for a table cascading from a location. */
    location?: LocationOf
    /**
     * The predicate of the step that deletes this table's expired rows,
     * which runs earlier in the round: the dry run leaves out the in-flight
     * rows it would delete first.
     */
    expired: (sql: TransactionSql) => Fragment
  }
): PurgeStep {
  const stranded = (sql: TransactionSql) => sql`
    status in ${sql(inFlight as string[])}
    and started_at <= now() - interval '24 hours'
  `
  return {
    key,
    table: attemptTable,
    kind: "reap",
    count: (sql, context) =>
      countRows(
        sql,
        attemptTable,
        context.deletesEnabled
          ? sql`${stranded(sql)} and not (${expired(sql)})
              ${notWithDueLocation(sql, context, location)}`
          : stranded(sql)
      ),
    run: async (sql, limit) => {
      const ids = await boundedRows(sql, {
        table: attemptTable,
        where: () => stranded(sql),
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

/** How long an ai_usage row is kept, from its creation (0059). */
export const AI_USAGE_RETENTION_MONTHS = 13

/**
 * The guard every ai_usage delete carries: the row's credit period is over
 * and the row itself is settled. Age alone is not enough, since a period's
 * rows are what its allowance and any later settlement are reckoned from:
 *
 * - a `reserved` row is a call still in flight (or one the job tick's
 *   release_stale_ai_reservations has yet to release), so it is never
 *   deleted whatever its age;
 * - a row of the current UTC month (lib/server/ai-credits.ts
 *   `billingPeriod`, the period still open) is never deleted, even if a
 *   clock or backdated row makes it look old;
 * - a row of an allowance period (`ai_credit_period`, plan P07, 0107) that
 *   has not ended is never deleted: a trial or paid period can run longer
 *   than a calendar month, and its allowance and any late settlement are
 *   reckoned from its rows until it ends. An operator adjustment that
 *   applies to the period (0115 `applies_to_period_id`) and is still open
 *   holds the period's rows too. A row with no period (usage recorded
 *   before 0107) has only the calendar-month rule above.
 *
 * This is the one place the purge decides whether a period is closed.
 * tests/retention-cycle.test.ts holds the purge's ai_usage statement to this
 * guard.
 */
export function aiUsageInClosedPeriod(sql: TransactionSql): Fragment {
  return sql`
    ai_usage.status in ('settled', 'released')
    and ai_usage.period_start
      < (date_trunc('month', now() at time zone 'utc'))::date
    and not exists (
      select 1 from ai_credit_period p
      where p.organisation_id = ai_usage.organisation_id
        and ai_usage.credit_period_id is not null
        and (
          p.id = ai_usage.credit_period_id
          or p.applies_to_period_id = ai_usage.credit_period_id
        )
        and p.ends_at > now()
    )
  `
}

/** An attempt or cache row past its own expiry. */
const pastExpiry = (sql: TransactionSql) => sql`expires_at <= now()`

/**
 * An expired media mutation, except an uncertain create nobody has resolved
 * yet: it blocks a re-create of the same content and holds what a person
 * needs to decide (lib/server/media.ts `unresolvedCreate`). It ages off once
 * resolved, since resolving leaves expires_at as is.
 */
const mediaMutationExpired = (sql: TransactionSql) => sql`
  expires_at <= now()
  and not (
    operation = 'create'
    and resolution is null
    and (
      status = 'needs_resolution'
      or (status = 'ambiguous' and upload_phase = 'create_sent')
    )
  )
`

/** Connections disconnected long enough ago that their data is due to go. */
const disconnectedDue = (sql: TransactionSql) => sql`
  select id from google_connection
  where status = 'disconnected'
    and purge_due_at <= now()
`

/** True for an external location none of whose reviews is held. */
const locationNotHeld = (sql: TransactionSql, locationId: Fragment) => sql`
  not exists (
    select 1 from review r
    join legal_hold h
      on h.review_id = r.id and h.released_at is null
    where r.external_location_id = ${locationId}
  )
`

/** The locations a disconnected purge removes: due and not held. */
const dueLocations = (sql: TransactionSql) => sql`
  select l.id from external_location l
  where l.google_connection_id in (${disconnectedDue(sql)})
    and ${locationNotHeld(sql, sql`l.id`)}
`

/**
 * For the dry run of a step that runs after disconnectedLocations: leaves
 * out rows whose location that step deletes first, since ON DELETE CASCADE
 * removes them before this step runs (hours, profile and food-menu state
 * and attempts, posts and their attempts, media, place actions, keywords,
 * import proposals). Only while deletes are on: off, no location goes.
 * Nothing for a step on a table with no location.
 */
function notWithDueLocation(
  sql: TransactionSql,
  { deletesEnabled }: StepContext,
  location: LocationOf | undefined
): Fragment {
  return deletesEnabled && location
    ? sql`and ${location(sql)} not in (${dueLocations(sql)})`
    : sql``
}

/**
 * Every dataset the purge retains, in the order each round runs them. The
 * predicates are the retention rules; each runs bounded (see boundedRows).
 * Each names its table in the retention inventory, whose entry lists the
 * step back (tests/retention-inventory.test.ts).
 */
function purgeSteps(organisationId: string): PurgeStep[] {
  return [
    // An audit row about a held review is kept with the review.
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
        and (
          audit_log.subject_type <> 'review'
          or ${notHeldReview(sql, sql`audit_log.subject_id`)}
        )
      `,
    }),
    // review_media_legal_hold_guard (0153) is the backstop for a hold
    // committed after this statement's snapshot: it waits for a hold being
    // applied to the review and skips that review's media.
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
    // review_unredacted_expiry_v2_idx (0100) is a partial index on exactly
    // this predicate: widening it needs a matching new index. The reviewer's
    // profile photo link is provider content like the name beside it, so it
    // expires with it; a re-ingest inside the window writes it back
    // (lib/server/reviews.ts) unless the review was erased.
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
          or reviewer_profile_photo_url is not null
          or raw_payload is not null
        )
      `,
      set: (sql) => sql`
        review_text = null,
        reviewer_display_name = null,
        reviewer_profile_photo_url = null,
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
    // review -> external_location is ON DELETE CASCADE (0001). The hold
    // predicate keeps a held location's reviews out; review_legal_hold_guard
    // (0141) is the backstop for a hold committed after this statement's
    // snapshot: it skips that review under app.retention_run, and fails a
    // cascade from external_location rather than delete a held review. A
    // review's released holds go with it (the guard deletes them; the
    // legal_hold -> review key is RESTRICT).
    // The row bound applies to the rows a statement selects, not to what
    // they cascade to, so a disconnected location's reviews (with their
    // media, replies and holds) are deleted in bounded batches first, and a
    // location goes only once it has none left. A location with any held
    // review keeps every review, exactly as it keeps itself.
    rowsStep("disconnectedReviews", {
      destructive: true,
      table: "review",
      where: (sql) => sql`external_location_id in (${dueLocations(sql)})`,
    }),
    // Once disconnectedReviews has run, a due location with no held review
    // has no review left, so the dry run counts exactly those.
    rowsStep("disconnectedLocations", {
      destructive: true,
      waitsFor: "disconnectedReviews",
      table: "external_location",
      where: (sql) => sql`
        google_connection_id in (${disconnectedDue(sql)})
        and not exists (
          select 1 from review r
          where r.external_location_id = external_location.id
        )
      `,
      dryRunWhere: (sql) => sql`id in (${dueLocations(sql)})`,
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
      location: ownLocation,
      table: "hours_sync_attempt",
      where: pastExpiry,
    }),
    rowsStep("keywordHistory", {
      location: ownLocation,
      destructive: true,
      table: "performance_search_keyword_monthly",
      where: (sql) => sql`
        metric_month < date_trunc('month', now()) - interval '18 months'
      `,
    }),
    // AI cost history (0059) holds no review text, so it is kept for
    // AI_USAGE_RETENTION_MONTHS rather than the raw-content window, and
    // never while its credit period is still open (aiUsageInClosedPeriod).
    // ai_usage_created_idx (0100) serves the scan.
    rowsStep("aiUsage", {
      destructive: true,
      table: "ai_usage",
      where: (sql) => sql`
        created_at < now() - make_interval(months => ${AI_USAGE_RETENTION_MONTHS})
        and ${aiUsageInClosedPeriod(sql)}
        and (
          ai_usage.review_id is null
          or ${notHeldReview(sql, sql`ai_usage.review_id::text`)}
        )
      `,
    }),
    rowsStep("placeActionMutations", {
      destructive: true,
      location: ownLocation,
      table: "place_action_mutation",
      where: pastExpiry,
    }),
    // An uncertain create nobody has resolved yet is kept past its expiry
    // (mediaMutationExpired).
    rowsStep("mediaMutations", {
      destructive: true,
      table: "gbp_media_mutation",
      where: mediaMutationExpired,
    }),
    rowsStep("managementMutations", {
      destructive: true,
      table: "gbp_management_mutation",
      where: pastExpiry,
    }),
    rowsStep("onboardingDrafts", {
      destructive: true,
      table: "google_onboarding_draft",
      where: pastExpiry,
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
      // disconnectedLocations (by cascade) and placeActionMutations run
      // first in the round, so an attempt either deletes no longer holds
      // its change set back.
      dryRunWhere: (sql, { deletesEnabled }) => sql`
        expires_at <= now()
        and not exists (
          select 1 from place_action_mutation m
          where m.change_set_id = gbp_change_set.id
            ${
              deletesEnabled
                ? sql`and not (m.expires_at <= now())
                    and m.external_location_id not in (${dueLocations(sql)})`
                : sql``
            }
        )
      `,
    }),
    // The snapshot is a cache keyed per resource and rebuilt on the next
    // read, and payload is jsonb NOT NULL, so it is deleted rather than
    // nulled out the way the sibling payload columns are.
    rowsStep("resourceSnapshots", {
      destructive: true,
      table: "gbp_resource_snapshot",
      where: pastExpiry,
    }),
    // snapshot_expires_at is NOT NULL (0016) and is reset on every
    // observation, so leave it in place; the value guard keeps the purge
    // idempotent for rows that have already been cleared.
    rowsStep("profileSnapshots", {
      location: ownLocation,
      table: "profile_field_state",
      where: (sql) => sql`
        snapshot_expires_at <= now()
        and (canonical_value is not null or google_value is not null)
      `,
      set: (sql) => sql`canonical_value = null, google_value = null`,
    }),
    rowsStep("profileAttempts", {
      destructive: true,
      location: ownLocation,
      table: "profile_sync_attempt",
      where: pastExpiry,
    }),
    rowsStep("postPayloads", {
      location: ownLocation,
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
      location: (sql) => sql`(
        select p.external_location_id from gbp_local_post p
        where p.id = gbp_local_post_attempt.post_id
      )`,
      table: "gbp_local_post_attempt",
      where: pastExpiry,
    }),
    // payload_expires_at is NOT NULL (0022) and is reset on every
    // observation, so leave it in place exactly as profile_field_state above
    // does; the value guard keeps the purge idempotent.
    rowsStep("googleMediaPayloads", {
      location: ownLocation,
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
      location: ownLocation,
      table: "food_menus_state",
      where: pastExpiry,
    }),
    rowsStep("foodMenuAttempts", {
      destructive: true,
      location: ownLocation,
      table: "food_menus_sync_attempt",
      where: pastExpiry,
    }),
    // Scheduled post history (post_publication_schedule, its occurrences
    // and gbp_local_post_legacy_schedule) has no step: D-47 keeps it until a
    // period is decided (lib/server/retention/inventory.ts).
    rowsStep("importProposals", {
      destructive: true,
      location: ownLocation,
      table: "presence_import_proposal",
      where: pastExpiry,
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
      table: "gbp_local_post",
      kind: "reap",
      once: true,
      run: async (sql) => (await reapStrandedLocalPosts(sql)).count,
      count: (sql, context) =>
        countRows(
          sql,
          "gbp_local_post",
          sql`${strandedLocalPost(sql)}
            ${notWithDueLocation(sql, context, ownLocation)}`
        ),
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
      expired: pastExpiry,
      location: ownLocation,
    }),
    strandedStep("strandedProfiles", "profile_sync_attempt", {
      inFlight: ["validating", "validated", "publishing"],
      errorColumn: "provider_error_code",
      expired: pastExpiry,
      location: ownLocation,
    }),
    strandedStep("strandedFoodMenus", "food_menus_sync_attempt", {
      inFlight: ["validating", "validated", "publishing"],
      errorColumn: "last_error_code",
      expired: pastExpiry,
      location: ownLocation,
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
      expired: mediaMutationExpired,
    }),
    strandedStep("strandedPlaceActions", "place_action_mutation", {
      inFlight: ["started"],
      errorColumn: "last_error_code",
      expired: pastExpiry,
      location: ownLocation,
    }),
    strandedStep("strandedManagement", "gbp_management_mutation", {
      inFlight: ["started", "validated"],
      errorColumn: "last_error_code",
      expired: pastExpiry,
    }),
    // Approved listing change requests whose dispatch never claimed an
    // attempt (lib/server/listing-changes.ts): nothing was sent for them,
    // and left `sent` they would read as in flight for good.
    {
      key: "interruptedApprovals",
      table: "mutation_operation",
      kind: "reap",
      once: true,
      run: (sql) => settleInterruptedListingChanges(sql, { organisationId }),
      count: (sql) =>
        countRows(
          sql,
          "mutation_operation",
          interruptedListingChange(sql, organisationId)
        ),
    },
  ]
}

export type RetentionPurgeStepInfo = Pick<
  PurgeStep,
  "key" | "table" | "kind" | "destructive" | "once"
>

/**
 * What each purge step acts on, in run order, for checking against the
 * retention inventory (tests/retention-inventory.test.ts).
 */
export function retentionPurgeCatalog(): RetentionPurgeStepInfo[] {
  return purgeSteps("00000000-0000-0000-0000-000000000000").map(
    ({ key, table, kind, destructive, once }) => ({
      key,
      table,
      kind,
      destructive: destructive ?? false,
      once: once ?? false,
    })
  )
}

/**
 * Locations held back from a disconnected purge: their connection is due,
 * but a review of theirs is under an unreleased legal hold.
 */
export async function countHeldDisconnectedLocations(
  sql: TransactionSql
): Promise<number> {
  const [held] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from external_location l
    where l.google_connection_id in (${disconnectedDue(sql)})
      and not (${locationNotHeld(sql, sql`l.id`)})
  `
  return held?.count ?? 0
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
  /**
   * Staged photo objects (media_asset, P09-R7) removed from private storage
   * after the rounds (0 or absent when none). Not a row dataset, so the dry
   * run does not preview it.
   */
  stagingAssets?: number
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
 * Each round that changed rows writes a `retention.purge.round` audit with
 * what it changed, in its own transaction. The round that finds everything
 * caught up also counts locations held back from a disconnected purge and
 * writes the `retention.purge.completed` audit, a summary with the
 * organisation's totals across the cycle (`priorCounts` plus this run), when
 * anything changed. The round audits are the complete record: the summary
 * misses rounds whose cycle counts were never recorded (a run killed after
 * committing) or were pruned with their cycle. Both the cycle dispatcher
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
      // Lets the round delete expired audit rows (0008), and makes
      // review_legal_hold_guard (0141) skip a review held mid-round instead
      // of failing the round: the next round's predicates exclude it.
      await sql`
        select set_config('app.retention_run', 'true', true)
      `
      const changed: OrganisationPurgeCounts = {}
      const behind: PurgeStep[] = []
      for (const step of pending) {
        const rows = await step.run(sql, limit)
        changed[step.key] = rows
        if (
          !step.once &&
          (rows >= limit ||
            behind.some((earlier) => earlier.key === step.waitsFor))
        ) {
          behind.push(step)
        }
      }
      // Every round that changed rows is audited in its own transaction, so
      // each committed change is on record in audit_log whatever becomes of
      // the run afterwards: a later round that fails, a run stopped until
      // its cycle gives up on it, a hand page nobody resumes, or a kill
      // before the cycle records the outcome. The completion audit below is
      // the summary; these rows are the record.
      const roundChanged = nonzero(changed)
      if (Object.keys(roundChanged).length) {
        await writeAudit(sql, {
          organisationId,
          action: "retention.purge.round",
          subjectType: "organisation",
          subjectId: organisationId,
          requestId: `${requestId}:${organisationId}:${rounds + 1}`,
          metadata: {
            ...roundChanged,
            round: rounds + 1,
            deletesEnabled,
            batchRows: limit,
            clientRequestId,
          },
        })
      }
      if (behind.length) return { changed, behind, held: 0 }
      // A held location keeps its connection past the seven-day promise
      // forever, so report it rather than letting the purge stall silently.
      const heldCount = await countHeldDisconnectedLocations(sql)
      const totals = addCounts(
        Object.fromEntries(steps.map((step) => [step.key, 0])),
        priorCounts,
        counts,
        changed
      )
      if (Object.values(totals).some((count) => count > 0) || heldCount > 0) {
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
  // Staged photo uploads (P09-R7, media_asset) older than 24 hours: their
  // objects are deleted from private storage once the tenant's rounds are
  // done, outside any tenant transaction because storage is not
  // transactional. The row stays, marked purged. Zero when storage is not
  // configured (nothing can have been staged). A storage failure is logged
  // and the next run tries again; it never fails the organisation. The rows
  // it marks get their own `retention.purge.staging_assets` audit, written
  // with them, since the rounds' audits cannot cover them.
  let stagingAssets = 0
  if (complete && deletesEnabled) {
    try {
      stagingAssets =
        (await purgeExpiredStagingAssets(organisationId, {
          limit,
          requestId,
          clientRequestId,
        })) ?? 0
    } catch (error) {
      log.error("retention.staging_assets_failed", {
        requestId,
        organisationId,
        error,
      })
    }
  }
  log.info(
    complete
      ? "retention.organisation_purged"
      : "retention.organisation_partial",
    {
      requestId,
      organisationId,
      rounds,
      behind: pending.map((step) => step.key),
      ...counts,
      heldLocationsSkipped,
      stagingAssets,
    }
  )
  return {
    complete,
    counts: { ...counts, heldLocationsSkipped },
    stagingAssets,
    rounds,
  }
}

export type RetentionFailure = {
  organisationId: string
  errorCode: string
}

/** A stable machine code for a failed organisation; never a message. */
export function retentionErrorCode(error: unknown): string {
  return (error instanceof ApiError ? error.code : "internal_error").slice(
    0,
    64
  )
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

/**
 * Purges the expired two-step sign-in tickets (mfa_pending_login, 0105).
 * Like the abuse-limit windows they are platform-level and short-lived (five
 * minutes), so RETENTION_DELETES_ENABLED does not stop this, and a failure is
 * logged without stopping the tenant walk.
 */
export async function purgeExpiredMfaTickets(
  requestId: string
): Promise<number | null> {
  try {
    return await purgeMfaPendingLogins()
  } catch (error) {
    log.error("retention.mfa_pending_failed", { requestId, error })
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
  const abuseRateBuckets = cursor
    ? null
    : await purgeEndedAbuseBuckets(requestId)
  const mfaPendingLogins = cursor
    ? null
    : await purgeExpiredMfaTickets(requestId)
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
      results.push({
        organisationId: organisation.id,
        ...purged.counts,
        stagingAssets: purged.stagingAssets ?? 0,
      })
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
    mfaPendingLogins,
    nextCursor: partial.length
      ? (lastProcessedOrganisationId ?? cursor ?? RETENTION_HEAD_CURSOR)
      : budgetExhausted || organisations.length === batchSize
        ? lastProcessedOrganisationId
        : null,
  }
}

/** The longest one dry-run count may take: the runtime role's own timeout. */
const DRY_RUN_STATEMENT_MS = 30_000

function dryRunBudgetExhausted(): ApiError {
  return new ApiError(
    503,
    "retention_dry_run_budget",
    "The dry run ran out of time before counting this organisation in full."
  )
}

export type OrganisationDryRun = {
  organisationId: string
  /**
   * Rows each dataset a purge would run now would change, by dataset key:
   * the destructive ones only while RETENTION_DELETES_ENABLED is on.
   */
  counts: OrganisationPurgeCounts
  /**
   * While RETENTION_DELETES_ENABLED is off, what the destructive datasets
   * would delete once it is turned back on; null while it is on.
   */
  deferredDeletes: OrganisationPurgeCounts | null
  heldLocationsSkipped: number
}

/**
 * The dry run of one organisation's purge (plan P04-4): every dataset's
 * would-change count, by a `select count(*)` on the predicate its step runs,
 * in one tenant transaction that changes no retained row. The counts are
 * what a purge started now would change in total across its rounds, while
 * nothing else writes in between (and while no dataset's backlog spans
 * rounds in which an earlier dataset is still deleting rows a later one
 * would otherwise reap). The one write is the `retention.dry_run` audit with
 * the counts, so an operator's preview is on record beside the purge it
 * predicts.
 *
 * Unlike the purge, each count is a full scan of its predicate, unbounded by
 * RETENTION_BATCH_ROWS, and the dry run answers to no pause. With a
 * `deadline`, no count runs past it: each statement's timeout is the time
 * left, and an organisation the budget cuts short fails with
 * `retention_dry_run_budget` rather than holding the route past its
 * maxDuration.
 */
export async function dryRunOrganisation({
  organisationId,
  requestId,
  clientRequestId,
  deletesEnabled,
  deadline,
}: {
  organisationId: string
  requestId: string
  clientRequestId: string | null
  deletesEnabled: boolean
  deadline?: number
}): Promise<OrganisationDryRun> {
  const steps = purgeSteps(organisationId)
  return withTenant(organisationId, async (sql) => {
    const bounded = async <T>(count: () => Promise<T>): Promise<T> => {
      if (deadline === undefined) return count()
      const left = Math.min(deadline - Date.now(), DRY_RUN_STATEMENT_MS)
      if (left <= 0) throw dryRunBudgetExhausted()
      await sql`select set_config('statement_timeout', ${String(left)}, true)`
      try {
        return await count()
      } catch (error) {
        throw (error as { code?: string }).code === "57014"
          ? dryRunBudgetExhausted()
          : error
      }
    }
    const counts: OrganisationPurgeCounts = {}
    for (const step of steps) {
      if (deletesEnabled || !step.destructive) {
        counts[step.key] = await bounded(() =>
          step.count(sql, { deletesEnabled })
        )
      }
    }
    let deferredDeletes: OrganisationPurgeCounts | null = null
    if (!deletesEnabled) {
      deferredDeletes = {}
      for (const step of steps) {
        if (step.destructive) {
          deferredDeletes[step.key] = await bounded(() =>
            step.count(sql, { deletesEnabled: true })
          )
        }
      }
    }
    const heldLocationsSkipped = await bounded(() =>
      countHeldDisconnectedLocations(sql)
    )
    if (deadline !== undefined) {
      await sql`select set_config('statement_timeout', '30000', true)`
    }
    await writeAudit(sql, {
      organisationId,
      action: "retention.dry_run",
      subjectType: "organisation",
      subjectId: organisationId,
      requestId: `${requestId}:${organisationId}`,
      metadata: {
        ...nonzero(counts),
        ...(deferredDeletes
          ? { deferredDeletes: nonzero(deferredDeletes) }
          : {}),
        heldLocationsSkipped,
        deletesEnabled,
        clientRequestId,
      },
    })
    return { organisationId, counts, deferredDeletes, heldLocationsSkipped }
  })
}

/**
 * One page of the dry run: up to `batchSize` organisations after `cursor`
 * (the head of the fleet when null), in organisation order, each previewed
 * by dryRunOrganisation. Read-only apart from its audits, so it neither
 * takes the retention lease nor answers to the retention pause: an operator
 * can preview a paused purge before resuming it, and must page it by hand
 * with that in mind, since each count scans its whole predicate. The page
 * budget (RETENTION_BUDGET_MS) bounds every count. RETENTION_DELETES_ENABLED
 * decides which counts are live and which deferred, as it would for the
 * purge. Follow `nextCursor` until it is null to preview the whole fleet.
 */
export async function dryRunPage({
  requestId,
  clientRequestId,
  cursor,
  batchSize,
}: RetentionPageInput) {
  const deletesEnabled = getServerEnv().RETENTION_DELETES_ENABLED
  const deadline = retentionDeadline()
  // Cross-tenant enumeration, as retainPage.
  const database = getDatabase()
  const organisations = await database<{ id: string }[]>`
    select organisation_id::text as id
    from organisation_job_route
    ${cursor ? database`where organisation_id > ${cursor}` : database``}
    order by organisation_id
    limit ${batchSize}
  `
  const results: OrganisationDryRun[] = []
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
      results.push(
        await dryRunOrganisation({
          organisationId: organisation.id,
          requestId,
          clientRequestId,
          deletesEnabled,
          deadline,
        })
      )
    } catch (error) {
      const errorCode = retentionErrorCode(error)
      // Out of time after other organisations: the next page previews this
      // one afresh. Alone on its page it cannot finish in any budget, so it
      // is reported failed and the walk moves on.
      if (errorCode === "retention_dry_run_budget" && processed > 0) {
        budgetExhausted = true
        break
      }
      failures.push({ organisationId: organisation.id, errorCode })
      log.error("retention.dry_run_failed", {
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
    dryRun: true as const,
    deletesEnabled,
    organisations: results,
    failures,
    nextCursor:
      budgetExhausted || organisations.length === batchSize
        ? lastProcessedOrganisationId
        : null,
  }
}
