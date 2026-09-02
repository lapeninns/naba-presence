import { writeAudit } from "@/lib/server/audit"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import { withAdvisoryLock } from "@/lib/server/leases"
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
        // Belt-and-braces: a crash between claim and mark strands a proposal
        // in processing, and only this statement unlocks the identity. The
        // predicate is 15 minutes but nothing runs it more often than the
        // retention tick, so the real bound is one retention interval - up to
        // 24 hours on the default RETENTION_INTERVAL_SECONDS.
        const strandedProposals = await sql`
          update presence_import_proposal
          set status = 'failed', failure_code = 'proposal_apply_failed', decided_at = now()
          where status = 'processing' and updated_at <= now() - interval '15 minutes'
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
          strandedProposals: strandedProposals.count,
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
