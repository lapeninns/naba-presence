import { NextResponse } from "next/server"

import { withTenant } from "@/lib/server/db"
import { apiError } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

export async function GET() {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const health = await withTenant(session.organisationId, async (sql) => {
      const [sync] = await sql`
        select
          count(*) filter (where status = 'running')::integer as running,
          count(*) filter (where status = 'pending')::integer as pending,
          count(*) filter (where status = 'failed')::integer as failed,
          max(last_review_update_time) as "lastSuccessfulReviewUpdate",
          min(created_at) filter (
            where status in ('pending', 'running')
          ) as "oldestOutstandingAt"
        from sync_checkpoint
      `
      const [webhooks] = await sql`
        select
          count(*) filter (
            where status in ('received', 'failed')
          )::integer as backlog,
          min(received_at) filter (
            where status in ('received', 'failed')
          ) as "oldestBacklogAt",
          count(*) filter (
            where status = 'failed'
              and received_at >= now() - interval '24 hours'
          )::integer as "failures24h"
        from processed_webhook_event
      `
      const connections = await sql`
        select status, count(*)::integer as count
        from google_connection
        group by status
        order by status
      `
      const publish = await sql`
        select
          status,
          count(*)::integer as count
        from publish_attempt
        where started_at >= now() - interval '24 hours'
        group by status
        order by status
      `
      const rejections = await sql`
        select
          coalesce(google_policy_violation, 'unspecified') as code,
          count(*)::integer as count
        from review_reply
        where google_reply_state = 'REJECTED'
          and updated_at >= now() - interval '30 days'
        group by google_policy_violation
        order by count desc
      `
      const [providerDivergence] = await sql<{ count: number }[]>`
        with local_totals as (
          select
            external_location_id,
            count(*)::integer as review_count,
            avg(star_rating)::float as average_rating
          from review
          where provider_deleted_at is null
          group by external_location_id
        )
        select count(*) filter (
          where (
            e.google_total_review_count is not null
            and abs(
              e.google_total_review_count -
              coalesce(lt.review_count, 0)
            )::float / greatest(e.google_total_review_count, 1) > 0.02
          ) or (
            e.google_average_rating is not null
            and lt.average_rating is not null
            and abs(
              e.google_average_rating::float - lt.average_rating
            ) > 0.1
          )
        )::integer as count
        from external_location e
        left join local_totals lt
          on lt.external_location_id = e.id
        where e.provider_totals_refreshed_at >=
          now() - interval '30 days'
      `
      return {
        generatedAt: new Date().toISOString(),
        sync,
        webhooks,
        connections,
        publish24h: publish,
        replyRejections30d: rejections,
        providerTotalDivergence30d: providerDivergence.count,
      }
    })
    return NextResponse.json(health, {
      headers: { "cache-control": "private, no-store" },
    })
  } catch (error) {
    return apiError(error)
  }
}
