import { NextResponse } from "next/server"

import { writeAudit } from "@/lib/server/audit"
import { secretEqual } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import { withAdvisoryLock } from "@/lib/server/leases"

export const runtime = "nodejs"
export const maxDuration = 60

async function retain(request: Request) {
  try {
    const rid = serverRequestId(request)
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "")
    if (!secretEqual(token, getServerEnv().CRON_SECRET)) {
      throw new ApiError(401, "invalid_cron_token", "Invalid cron token.")
    }
    const params = new URL(request.url).searchParams
    const cursor = params.get("cursor")
    const batchSize = Math.min(
      100,
      Math.max(1, Number(params.get("batch_size") ?? 25) || 25)
    )
    const database = getDatabase()
    const organisations = await getDatabase()<{ id: string }[]>`
      select organisation_id::text as id
      from organisation_job_route
      ${cursor ? database`where organisation_id > ${cursor}` : database``}
      order by organisation_id
      limit ${batchSize}
    `
    const results = []
    for (const organisation of organisations) {
      const purged = await withTenant(organisation.id, async (sql) => {
        await sql`
          select set_config('app.retention_run', 'true', true)
        `
        const auditLogs = await sql`
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
        const media = await sql`
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
        const disconnected = await sql`
          delete from external_location
          where google_connection_id in (
            select id from google_connection
            where status = 'disconnected'
              and purge_due_at <= now()
          )
          returning id
        `
        const webhookPayloads = await sql`
          update processed_webhook_event
          set payload = null
          where payload_expires_at <= now()
            and payload is not null
          returning id
        `
        const hoursAttempts = await sql`
          delete from hours_sync_attempt
          where expires_at <= now()
          returning id
        `
        const keywordHistory = await sql`
          delete from performance_search_keyword_monthly
          where metric_month < date_trunc('month', now()) - interval '18 months'
          returning id
        `
        const placeActionMutations = await sql`
          delete from place_action_mutation
          where expires_at <= now()
          returning id
        `
        const mediaMutations = await sql`
          delete from gbp_media_mutation
          where expires_at <= now()
          returning id
        `
        const profileSnapshots = await sql`
          update profile_field_state
          set canonical_value = null, google_value = null,
            snapshot_expires_at = null
          where snapshot_expires_at <= now()
            and (canonical_value is not null or google_value is not null)
          returning id
        `
        const profileAttempts = await sql`
          delete from profile_sync_attempt where expires_at <= now()
          returning id
        `
        const postPayloads = await sql`
          update gbp_local_post
          set provider_payload = null, provider_payload_expires_at = null
          where provider_payload_expires_at <= now() and provider_payload is not null
          returning id
        `
        const postAttempts = await sql`
          delete from gbp_local_post_attempt where expires_at <= now()
          returning id
        `
        const googleMediaPayloads = await sql`
          update gbp_media_item
          set source_url = null, google_url = null, thumbnail_url = null,
            description = null, attribution = null, dimensions = null,
            insights = null, payload_expires_at = null
          where payload_expires_at <= now()
          returning id
        `
        const foodMenuStates = await sql`
          delete from food_menus_state where expires_at <= now()
          returning id
        `
        const foodMenuAttempts = await sql`
          delete from food_menus_sync_attempt where expires_at <= now()
          returning id
        `
        const importProposals = await sql`
          delete from presence_import_proposal where expires_at <= now()
          returning id
        `
        // Belt-and-braces: a crash between claim and mark strands a proposal
        // in processing; fail it after 15 minutes so the identity unlocks.
        const strandedProposals = await sql`
          update presence_import_proposal
          set status = 'failed', failure_code = 'proposal_apply_failed', decided_at = now()
          where status = 'processing' and updated_at <= now() - interval '15 minutes'
          returning id
        `
        const counts = {
          auditLogs: auditLogs.count,
          media: media.count,
          reviews: reviews.count,
          accounts: accounts.count,
          locations: locations.count,
          disconnectedLocations: disconnected.count,
          webhookPayloads: webhookPayloads.count,
          hoursAttempts: hoursAttempts.count,
          keywordHistory: keywordHistory.count,
          placeActionMutations: placeActionMutations.count,
          mediaMutations: mediaMutations.count,
          profileSnapshots: profileSnapshots.count,
          profileAttempts: profileAttempts.count,
          postPayloads: postPayloads.count,
          postAttempts: postAttempts.count,
          googleMediaPayloads: googleMediaPayloads.count,
          foodMenuStates: foodMenuStates.count,
          foodMenuAttempts: foodMenuAttempts.count,
          importProposals: importProposals.count,
          strandedProposals: strandedProposals.count,
        }
        if (Object.values(counts).some((count) => count > 0)) {
          await writeAudit(sql, {
            organisationId: organisation.id,
            action: "retention.purge.completed",
            subjectType: "organisation",
            subjectId: organisation.id,
            requestId: `${rid.id}:${organisation.id}`,
            metadata: {
              ...counts,
              clientRequestId: rid.clientId,
            },
          })
        }
        return counts
      })
      results.push({ organisationId: organisation.id, ...purged })
    }
    return NextResponse.json({
      organisations: results,
      nextCursor:
        organisations.length === batchSize ? organisations.at(-1)?.id : null,
    })
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const result = await withAdvisoryLock("naba:retention", () =>
      retain(request)
    )
    return result instanceof NextResponse
      ? result
      : NextResponse.json(result)
  } catch (error) {
    return apiError(error)
  }
}
