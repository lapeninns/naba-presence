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
    })
    const analytics = await withTenant(session.organisationId, async (sql) => {
      await requireLocationAccess(sql, session, id)
      const from =
        query.from ?? new Date(Date.now() - 30 * 86400000).toISOString()
      const to = query.to ?? new Date().toISOString()
      const [location] = await sql`
        select
          l.id::text as id,
          l.name,
          l.timezone,
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
          count(r.id) filter (
            where r.star_rating <= 2
              and coalesce(rr.publish_status, 'not_published')
                not in ('accepted', 'published')
          )::integer as "unresolvedComplaints"
        from location l
        left join review r on r.location_id = l.id
          and r.create_time >= ${from}
          and r.create_time <= ${to}
        left join review_reply rr on rr.review_id = r.id
        where l.id = ${id}
        group by l.id, l.name, l.timezone
      `
      if (!location) {
        throw new ApiError(404, "location_not_found", "Location not found.")
      }
      const ratings = await sql`
        select star_rating as rating, count(*)::integer as count
        from review
        where location_id = ${id}
          and create_time >= ${from}
          and create_time <= ${to}
        group by star_rating
        order by star_rating desc
      `
      return { location, ratings }
    })
    return NextResponse.json(analytics)
  } catch (error) {
    return apiError(error)
  }
}
