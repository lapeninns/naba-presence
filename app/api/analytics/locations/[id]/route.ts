import { NextResponse } from "next/server"
import { z } from "zod"

import { withTenant } from "@/lib/server/db"
import { ApiError, apiError } from "@/lib/server/http"
import { requireLocationAccess } from "@/lib/server/permissions"
import { requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const querySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  granularity: z.enum(["day", "week", "month"]).default("day"),
})

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    const params = new URL(request.url).searchParams
    const query = querySchema.parse({
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      granularity: params.get("granularity") ?? undefined,
    })
    const analytics = await withTenant(session.organisationId, async (sql) => {
      await requireLocationAccess(sql, session, id)
      const from =
        query.from ?? new Date(Date.now() - 30 * 86400000).toISOString()
      const to = query.to ?? new Date().toISOString()
      const [locationIdentity] = await sql<{
        id: string
        name: string
        timezone: string
      }[]>`
        select
          l.id::text as id,
          l.name,
          l.timezone
        from location l
        where l.id = ${id}
      `
      if (!locationIdentity) {
        throw new ApiError(404, "location_not_found", "Location not found.")
      }
      const timezone = locationIdentity.timezone
      const bucketInterval =
        query.granularity === "month"
          ? "1 month"
          : query.granularity === "week"
            ? "1 week"
            : "1 day"
      const [summary] = await sql`
        select
          count(r.id)::integer as "reviewVolume",
          round(avg(r.star_rating)::numeric, 2)::float as "averageRating",
          round(
            100.0 * count(rr.id) filter (
              where rr.publish_status in ('accepted', 'published')
            ) / nullif(count(r.id), 0),
            1
          )::float as "responseRate",
          percentile_cont(0.5) within group (
            order by extract(epoch from (
              rr.first_published_at - r.create_time
            ))
          ) filter (
            where rr.first_published_at is not null
              and rr.publish_status not in ('deleted', 'not_published')
          )::float as "medianFirstResponseSeconds",
          percentile_cont(0.95) within group (
            order by extract(epoch from (
              rr.first_published_at - r.create_time
            ))
          ) filter (
            where rr.first_published_at is not null
              and rr.publish_status not in ('deleted', 'not_published')
          )::float as "p95FirstResponseSeconds",
          percentile_cont(0.5) within group (
            order by extract(epoch from (
              rr.google_reply_updated_at - r.create_time
            ))
          ) filter (
            where rr.google_reply_updated_at is not null
              and rr.publish_status not in ('deleted', 'not_published')
          )::float as "medianLatestEditSeconds",
          count(r.id) filter (
            where r.star_rating is not null
              and r.star_rating <= 2
              and coalesce(rr.publish_status, 'not_published')
                not in ('accepted', 'published')
          )::integer as "unresolvedComplaints"
        from review r
        left join review_reply rr on rr.review_id = r.id
        where r.location_id = ${id}
          and r.provider_deleted_at is null
          and r.create_time >= ${from}
          and r.create_time <= ${to}
      `
      const location = { ...locationIdentity, ...summary }
      const ratings = await sql`
        select star_rating as rating, count(*)::integer as count
        from review
        where location_id = ${id}
          and provider_deleted_at is null
          and star_rating is not null
          and create_time >= ${from}
          and create_time <= ${to}
        group by star_rating
        order by star_rating desc
      `
      const series = await sql`
        with buckets as (
          select generate_series(
            date_trunc(
              ${query.granularity},
              ${from}::timestamptz,
              ${timezone}
            ),
            date_trunc(
              ${query.granularity},
              ${to}::timestamptz,
              ${timezone}
            ),
            ${bucketInterval}::interval
          ) as period
        ),
        counted as (
          select
            date_trunc(
              ${query.granularity},
              r.create_time,
              ${timezone}
            ) as period,
            count(*)::integer as "reviewCount",
            count(rr.id) filter (
              where rr.publish_status in ('accepted', 'published')
            )::integer as replies,
            round(avg(r.star_rating)::numeric, 2)::float as "averageRating"
          from review r
          left join review_reply rr on rr.review_id = r.id
          where r.location_id = ${id}
            and r.provider_deleted_at is null
            and r.create_time >= ${from}
            and r.create_time <= ${to}
          group by 1
        )
        select
          b.period,
          coalesce(c."reviewCount", 0)::integer as "reviewCount",
          coalesce(c."reviewCount", 0)::integer as reviews,
          coalesce(c.replies, 0)::integer as replies,
          c."averageRating"
        from buckets b
        left join counted c using (period)
        order by b.period
      `
      return { timezone, location, ratings, series }
    })
    return NextResponse.json(analytics)
  } catch (error) {
    return apiError(error)
  }
}
