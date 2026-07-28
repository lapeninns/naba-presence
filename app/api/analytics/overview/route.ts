import { NextResponse } from "next/server"
import { z } from "zod"

import { withTenant } from "@/lib/server/db"
import { apiError } from "@/lib/server/http"
import { requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const querySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  granularity: z.enum(["day", "week", "month"]).default("day"),
})

export async function GET(request: Request) {
  try {
    const session = await requireSession()
    const params = new URL(request.url).searchParams
    const query = querySchema.parse({
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      granularity: params.get("granularity") ?? undefined,
    })
    const analytics = await withTenant(session.organisationId, async (sql) => {
      const from =
        query.from ?? new Date(Date.now() - 30 * 86400000).toISOString()
      const to = query.to ?? new Date().toISOString()
      const period =
        query.granularity === "month"
          ? sql`date_trunc('month', r.create_time)`
          : query.granularity === "week"
            ? sql`date_trunc('week', r.create_time)`
            : sql`date_trunc('day', r.create_time)`
      const [summary] = await sql`
        select
          count(*)::integer as "reviewVolume",
          round(avg(r.star_rating)::numeric, 2)::float as "averageRating",
          round(
            100.0 * count(rr.id) filter (
              where rr.publish_status in ('accepted', 'published')
            ) / nullif(count(*), 0),
            1
          )::float as "responseRate",
          count(*) filter (
            where r.star_rating <= 2
              and coalesce(rr.publish_status, 'not_published')
                not in ('accepted', 'published')
          )::integer as "unresolvedComplaints",
          count(*) filter (
            where d.verification_status = 'fail'
          )::integer as "verificationFailures",
          round(
            100.0 * count(d.id) filter (
              where d.verification_status = 'fail'
            ) / nullif(count(d.id), 0),
            1
          )::float as "verificationRejectionRate",
          percentile_cont(0.5) within group (
            order by extract(epoch from (
              rr.google_reply_updated_at - r.create_time
            ))
          ) filter (
            where rr.google_reply_updated_at is not null
          )::float as "medianResponseSeconds",
          percentile_cont(0.95) within group (
            order by extract(epoch from (
              rr.google_reply_updated_at - r.create_time
            ))
          ) filter (
            where rr.google_reply_updated_at is not null
          )::float as "p95ResponseSeconds"
        from review r
        left join review_reply rr on rr.review_id = r.id
        left join lateral (
          select verification_status
          from draft
          where review_id = r.id
          order by created_at desc
          limit 1
        ) d on true
        where r.create_time >= ${from}
          and r.create_time <= ${to}
          ${
            session.role === "owner" || session.role === "admin"
              ? sql``
              : sql`and (
                  not exists (
                    select 1 from location_member lm
                    where lm.user_id = ${session.userId}
                  )
                  or exists (
                    select 1 from location_member lm
                    where lm.user_id = ${session.userId}
                      and lm.location_id = r.location_id
                  )
                )`
          }
      `
      const series = await sql`
        select
          ${period} as period,
          count(*)::integer as reviews,
          count(rr.id) filter (
            where rr.publish_status in ('accepted', 'published')
          )::integer as replies,
          round(avg(r.star_rating)::numeric, 2)::float as "averageRating"
        from review r
        left join review_reply rr on rr.review_id = r.id
        where r.create_time >= ${from}
          and r.create_time <= ${to}
          ${
            session.role === "owner" || session.role === "admin"
              ? sql``
              : sql`and (
                  not exists (
                    select 1 from location_member lm
                    where lm.user_id = ${session.userId}
                  )
                  or exists (
                    select 1 from location_member lm
                    where lm.user_id = ${session.userId}
                      and lm.location_id = r.location_id
                  )
                )`
          }
        group by 1
        order by 1
      `
      const locations = await sql`
        select
          l.id::text as id,
          l.name,
          count(*)::integer as reviews,
          round(avg(r.star_rating)::numeric, 2)::float as "averageRating",
          round(
            100.0 * count(rr.id) filter (
              where rr.publish_status in ('accepted', 'published')
            ) / nullif(count(*), 0),
            1
          )::float as "responseRate",
          percentile_cont(0.5) within group (
            order by extract(epoch from (
              rr.google_reply_updated_at - r.create_time
            ))
          ) filter (
            where rr.google_reply_updated_at is not null
          )::float as "medianResponseSeconds",
          percentile_cont(0.95) within group (
            order by extract(epoch from (
              rr.google_reply_updated_at - r.create_time
            ))
          ) filter (
            where rr.google_reply_updated_at is not null
          )::float as "p95ResponseSeconds",
          count(*) filter (
            where r.star_rating <= 2
              and coalesce(rr.publish_status, 'not_published')
                not in ('accepted', 'published')
          )::integer as "unresolvedComplaints",
          round(
            100.0 * count(d.id) filter (
              where d.verification_status = 'fail'
            ) / nullif(count(d.id), 0),
            1
          )::float as "verificationRejectionRate"
        from review r
        join location l on l.id = r.location_id
        left join review_reply rr on rr.review_id = r.id
        left join lateral (
          select id, verification_status
          from draft
          where review_id = r.id
          order by created_at desc
          limit 1
        ) d on true
        where r.create_time >= ${from}
          and r.create_time <= ${to}
          ${
            session.role === "owner" || session.role === "admin"
              ? sql``
              : sql`and (
                  not exists (
                    select 1 from location_member lm
                    where lm.user_id = ${session.userId}
                  )
                  or exists (
                    select 1 from location_member lm
                    where lm.user_id = ${session.userId}
                      and lm.location_id = r.location_id
                  )
                )`
          }
        group by l.id, l.name
        order by "averageRating" desc
      `
      return { from, to, summary, series, locations }
    })
    return NextResponse.json(analytics)
  } catch (error) {
    return apiError(error)
  }
}
