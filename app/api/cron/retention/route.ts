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
        const counts = {
          media: media.count,
          reviews: reviews.count,
          accounts: accounts.count,
          locations: locations.count,
          disconnectedLocations: disconnected.count,
          webhookPayloads: webhookPayloads.count,
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
