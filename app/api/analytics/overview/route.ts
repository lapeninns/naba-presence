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
      const [organisation] = await sql<{ timezone: string }[]>`
        select default_timezone as timezone
        from organisation
        where id = ${session.organisationId}
      `
      const timezone = organisation?.timezone ?? "UTC"
      const bucketInterval =
        query.granularity === "month"
          ? "1 month"
          : query.granularity === "week"
            ? "1 week"
            : "1 day"
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
            where r.star_rating is not null
              and r.star_rating <= 2
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
          )::float as "medianLatestEditSeconds"
        from review r
        left join review_reply rr on rr.review_id = r.id
        left join lateral (
          select id, verification_status
          from draft
          where review_id = r.id
          order by created_at desc
          limit 1
        ) d on true
        where r.provider_deleted_at is null
          and r.create_time >= ${from}
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
          where r.provider_deleted_at is null
            and r.create_time >= ${from}
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
          count(*) filter (
            where r.star_rating is not null
              and r.star_rating <= 2
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
        where r.provider_deleted_at is null
          and r.create_time >= ${from}
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
      const [providerRow] = await sql<
        {
          averageRating: number | null
          totalReviewCount: number | null
          localReviewCount: number
          localAverageRating: number | null
        }[]
      >`
        select
          round(
            sum(
              e.google_average_rating * e.google_total_review_count
            ) / nullif(sum(e.google_total_review_count), 0),
            2
          )::float as "averageRating",
          sum(e.google_total_review_count)::integer as "totalReviewCount",
          (
            select count(*)::integer
            from review r
            where r.provider_deleted_at is null
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
          ) as "localReviewCount",
          (
            select avg(r.star_rating)::float
            from review r
            where r.provider_deleted_at is null
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
          ) as "localAverageRating"
        from external_location e
        join location_link ll
          on ll.external_location_id = e.id
         and ll.is_active = true
        where e.provider_totals_refreshed_at is not null
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
                      and lm.location_id = ll.location_id
                  )
                )`
          }
      `
      const countDivergence =
        providerRow.totalReviewCount !== null &&
        Math.abs(
          providerRow.totalReviewCount - providerRow.localReviewCount
        ) /
          Math.max(providerRow.totalReviewCount, 1) >
          0.02
      const ratingDivergence =
        providerRow.averageRating !== null &&
        providerRow.localAverageRating !== null &&
        Math.abs(
          providerRow.averageRating - providerRow.localAverageRating
        ) > 0.1
      const providerTotals = {
        averageRating: providerRow.averageRating,
        totalReviewCount: providerRow.totalReviewCount,
        localReviewCount: providerRow.localReviewCount,
        divergence: countDivergence || ratingDivergence,
      }
      return {
        from,
        to,
        timezone,
        summary,
        series,
        locations,
        providerTotals,
      }
    })
    return NextResponse.json(analytics)
  } catch (error) {
    return apiError(error)
  }
}
