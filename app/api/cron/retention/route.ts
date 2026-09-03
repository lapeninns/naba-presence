import { writeAudit } from "@/lib/server/audit"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import { withAdvisoryLock } from "@/lib/server/leases"
import { reapStrandedLocalPosts } from "@/lib/server/posts"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

type RetentionInput = {
  requestId: string
  clientRequestId: string | null
  cursor: string | null
  batchSize: number
}

type RetentionFailure = {
  organisationId: string
  errorCode: string
}

type CountedStatement = { count: number }

/**
 * Runs a destructive statement only while deletion is enabled. The
 * irreversible half of retention answers to its own kill switch, so an
 * operator can stop deleting during an incident while redaction of expired
 * provider content keeps running for the obligation it exists to meet.
 */
async function purge(
  enabled: boolean,
  statement: () => Promise<CountedStatement>
): Promise<number> {
  return enabled ? (await statement()).count : 0
}

async function retain({
  requestId,
  clientRequestId,
  cursor,
  batchSize,
}: RetentionInput) {
  const env = getServerEnv()
  if (!env.RETENTION_ENABLED) {
    throw new ApiError(
      503,
      "retention_paused",
      "Retention is paused. Set RETENTION_ENABLED=true to resume the purge."
    )
  }
  const deletesEnabled = env.RETENTION_DELETES_ENABLED
  // Stay inside the scheduler's 55s abort so a long page returns a cursor
  // instead of discarding every organisation it already committed.
  const configuredBudget = Number(process.env.RETENTION_BUDGET_MS ?? 45_000)
  const deadline =
    Date.now() +
    (Number.isFinite(configuredBudget) && configuredBudget >= 0
      ? configuredBudget
      : 45_000)
  // Cross-tenant enumeration: the cron walks every organisation that has a
  // job route, so this one read deliberately runs outside withTenant.
  const database = getDatabase()
  const organisations = await getDatabase()<{ id: string }[]>`
    select organisation_id::text as id
    from organisation_job_route
    ${cursor ? database`where organisation_id > ${cursor}` : database``}
    order by organisation_id
    limit ${batchSize}
  `
  const results = []
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
      const purged = await withTenant(organisation.id, async (sql) => {
        await sql`
          select set_config('app.retention_run', 'true', true)
        `
        const auditLogs = await purge(
          deletesEnabled,
          () => sql`
            delete from audit_log
            where created_at < now() - make_interval(
              days => (
                select audit_retention_days
                from organisation
                where id = ${organisation.id}
              )
            )
            returning id
          `
        )
        const media = await purge(
          deletesEnabled,
          () => sql`
            delete from review_media_item m
            using review r
            where m.review_id = r.id
              and r.raw_content_expires_at <= now()
              and not exists (
                select 1 from legal_hold h
                where h.review_id = r.id
                  and h.released_at is null
              )
            returning m.id
          `
        )
        const reviews = await sql`
          update review
          set
            review_text = null,
            reviewer_display_name = null,
            raw_payload = null
          where raw_content_expires_at <= now()
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
          returning id
        `
        const accounts = await sql`
          update google_account
          set raw_payload = null
          where raw_content_expires_at <= now()
            and raw_payload is not null
          returning id
        `
        const locations = await sql`
          update external_location
          set raw_payload = null, address_json = null
          where raw_content_expires_at <= now()
            and (raw_payload is not null or address_json is not null)
          returning id
        `
        // review -> external_location and legal_hold -> review are both ON
        // DELETE CASCADE (0001), so without this predicate the purge would
        // destroy held reviews and the holds protecting them in one statement.
        const disconnected = await purge(
          deletesEnabled,
          () => sql`
            delete from external_location
            where google_connection_id in (
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
            returning id
          `
        )
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
        // A one-time reaper, not an ongoing obligation: the Pub/Sub route no
        // longer writes `payload` or `payload_expires_at`, so this only ages
        // out rows written before that change. It can be deleted once the
        // oldest of them has passed its 30-day expiry.
        const webhookPayloads = await sql`
          update processed_webhook_event
          set payload = null
          where payload_expires_at <= now()
            and payload is not null
          returning id
        `
        const hoursAttempts = await purge(
          deletesEnabled,
          () => sql`
            delete from hours_sync_attempt
            where expires_at <= now()
            returning id
          `
        )
        const keywordHistory = await purge(
          deletesEnabled,
          () => sql`
            delete from performance_search_keyword_monthly
            where metric_month < date_trunc('month', now()) - interval '18 months'
            returning id
          `
        )
        const placeActionMutations = await purge(
          deletesEnabled,
          () => sql`
            delete from place_action_mutation
            where expires_at <= now()
            returning id
          `
        )
        const mediaMutations = await purge(
          deletesEnabled,
          () => sql`
            delete from gbp_media_mutation
            where expires_at <= now()
            returning id
          `
        )
        const managementMutations = await purge(
          deletesEnabled,
          () => sql`
            delete from gbp_management_mutation
            where expires_at <= now()
            returning id
          `
        )
        // The snapshot is a cache keyed per resource and rebuilt on the next
        // read, and payload is jsonb NOT NULL, so it is deleted rather than
        // nulled out the way the sibling payload columns are.
        const resourceSnapshots = await purge(
          deletesEnabled,
          () => sql`
            delete from gbp_resource_snapshot
            where expires_at <= now()
            returning id
          `
        )
        // snapshot_expires_at is NOT NULL (0016) and is reset on every
        // observation, so leave it in place; the value guard below keeps
        // the purge idempotent for rows that have already been cleared.
        const profileSnapshots = await sql`
          update profile_field_state
          set canonical_value = null, google_value = null
          where snapshot_expires_at <= now()
            and (canonical_value is not null or google_value is not null)
          returning id
        `
        const profileAttempts = await purge(
          deletesEnabled,
          () => sql`
            delete from profile_sync_attempt where expires_at <= now()
            returning id
          `
        )
        const postPayloads = await sql`
          update gbp_local_post
          set provider_payload = null, provider_payload_expires_at = null
          where provider_payload_expires_at <= now() and provider_payload is not null
          returning id
        `
        const postAttempts = await purge(
          deletesEnabled,
          () => sql`
            delete from gbp_local_post_attempt where expires_at <= now()
            returning id
          `
        )
        // payload_expires_at is NOT NULL (0022) and is reset on every
        // observation, so leave it in place exactly as profile_field_state
        // above does; the value guard keeps the purge idempotent.
        const googleMediaPayloads = await sql`
          update gbp_media_item
          set source_url = null, google_url = null, thumbnail_url = null,
            description = null, attribution = null, dimensions = null,
            insights = null
          where payload_expires_at <= now()
            and (
              source_url is not null
              or google_url is not null
              or thumbnail_url is not null
              or description is not null
              or attribution is not null
              or dimensions is not null
              or insights is not null
            )
          returning id
        `
        const foodMenuStates = await purge(
          deletesEnabled,
          () => sql`
            delete from food_menus_state where expires_at <= now()
            returning id
          `
        )
        const foodMenuAttempts = await purge(
          deletesEnabled,
          () => sql`
            delete from food_menus_sync_attempt where expires_at <= now()
            returning id
          `
        )
        const importProposals = await purge(
          deletesEnabled,
          () => sql`
            delete from presence_import_proposal where expires_at <= now()
            returning id
          `
        )
        // Sign-out and organisation switch are the only other deleters, so
        // without this a dead session row (with its token hash and any
        // impersonation reason) outlives the audit trail above it. RLS scopes
        // the statement to this tenant via session_isolation (0001).
        const appSessions = await purge(
          deletesEnabled,
          () => sql`
            delete from app_session
            where expires_at < now() - interval '7 days'
            returning id
          `
        )
        // Rows an interrupted publish left claiming to be publishing. The
        // reaper is here rather than in the module because every user-facing
        // path already reclaims the location's rows before listing; this is
        // for the tenant nobody opens.
        const strandedPosts = await reapStrandedLocalPosts(sql)
        // The same shape one level up, for the GBP write surfaces. runGbpWrite
        // recovers an in-flight row by readback on the next request for the
        // SAME key, so this only reaches rows nothing will ever revisit: the
        // write landed, the snapshot moved, and the next publish derives a
        // different key. Twenty-four hours is far past the two-minute
        // in-flight grace, so the readback path still owns every fresh row;
        // past it a settled 'ambiguous' row re-arms on its next same-key
        // request rather than blocking it.
        //
        // All THREE in-flight statuses, not just 'publishing': hours and
        // profile issue a validateOnly call to Google during 'validating',
        // outside any transaction, so an interrupted request strands there
        // just as readily. ('validated' never occurs on food menus -- its
        // CHECK omits the value -- so the predicate simply does not match.)
        const strandedHours = await sql`
          update hours_sync_attempt
          set status = 'ambiguous', provider_error_code = 'attempt_interrupted',
            finished_at = now()
          where status in ('validating', 'validated', 'publishing')
            and started_at <= now() - interval '24 hours'
          returning id
        `
        const strandedProfiles = await sql`
          update profile_sync_attempt
          set status = 'ambiguous', provider_error_code = 'attempt_interrupted',
            finished_at = now()
          where status in ('validating', 'validated', 'publishing')
            and started_at <= now() - interval '24 hours'
          returning id
        `
        const strandedFoodMenus = await sql`
          update food_menus_sync_attempt
          set status = 'ambiguous', last_error_code = 'attempt_interrupted',
            finished_at = now()
          where status in ('validating', 'validated', 'publishing')
            and started_at <= now() - interval '24 hours'
          returning id
        `
        // The remaining three surfaces map every in-flight phase onto
        // 'started' (their CHECK admits no finer vocabulary), and only place
        // actions carries started_at -- the other two are aged off created_at,
        // which is written in the same statement that opens the attempt.
        const strandedMedia = await sql`
          update gbp_media_mutation
          set status = 'ambiguous', last_error_code = 'attempt_interrupted',
            finished_at = now()
          where status = 'started'
            and created_at <= now() - interval '24 hours'
          returning id
        `
        const strandedPlaceActions = await sql`
          update place_action_mutation
          set status = 'ambiguous', last_error_code = 'attempt_interrupted',
            finished_at = now()
          where status = 'started'
            and started_at <= now() - interval '24 hours'
          returning id
        `
        const strandedManagement = await sql`
          update gbp_management_mutation
          set status = 'ambiguous', last_error_code = 'attempt_interrupted',
            finished_at = now()
          where status in ('started', 'validated')
            and created_at <= now() - interval '24 hours'
          returning id
        `
        const counts = {
          auditLogs,
          media,
          reviews: reviews.count,
          accounts: accounts.count,
          locations: locations.count,
          disconnectedLocations: disconnected,
          webhookPayloads: webhookPayloads.count,
          hoursAttempts,
          keywordHistory,
          placeActionMutations,
          mediaMutations,
          managementMutations,
          resourceSnapshots,
          profileSnapshots: profileSnapshots.count,
          profileAttempts,
          postPayloads: postPayloads.count,
          postAttempts,
          googleMediaPayloads: googleMediaPayloads.count,
          foodMenuStates,
          foodMenuAttempts,
          importProposals,
          appSessions,
          strandedPosts: strandedPosts.count,
          strandedHours: strandedHours.count,
          strandedProfiles: strandedProfiles.count,
          strandedFoodMenus: strandedFoodMenus.count,
          strandedMedia: strandedMedia.count,
          strandedPlaceActions: strandedPlaceActions.count,
          strandedManagement: strandedManagement.count,
        }
        const heldLocationsSkipped = held?.count ?? 0
        if (
          Object.values(counts).some((count) => count > 0) ||
          heldLocationsSkipped > 0
        ) {
          await writeAudit(sql, {
            organisationId: organisation.id,
            action: "retention.purge.completed",
            subjectType: "organisation",
            subjectId: organisation.id,
            requestId: `${requestId}:${organisation.id}`,
            metadata: {
              ...counts,
              heldLocationsSkipped,
              deletesEnabled,
              clientRequestId,
            },
          })
        }
        return { ...counts, heldLocationsSkipped }
      })
      // Logged outside the transaction so a rolled-back purge never reports
      // counts it did not keep.
      log.info("retention.organisation_purged", {
        requestId,
        organisationId: organisation.id,
        ...purged,
      })
      results.push({ organisationId: organisation.id, ...purged })
    } catch (error) {
      // One tenant's failure must not starve every organisation ordered after
      // it: the enumeration order is stable and the scheduler always restarts
      // at the head, so an uncaught throw here would skip the same tail on
      // every subsequent run.
      const errorCode =
        error instanceof ApiError ? error.code : "internal_error"
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
    failures,
    nextCursor:
      budgetExhausted || organisations.length === batchSize
        ? lastProcessedOrganisationId
        : null,
  }
}

export const POST = route({
  auth: "cron",
  query: (searchParams) => ({
    cursor: searchParams.get("cursor"),
    batchSize: Math.min(
      100,
      Math.max(1, Number(searchParams.get("batch_size") ?? 25) || 25)
    ),
  }),
  handler: ({ requestId, clientRequestId, query }) =>
    withAdvisoryLock("naba:retention", () =>
      retain({ requestId, clientRequestId, ...query })
    ),
})
