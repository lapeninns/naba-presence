import "server-only"

import type { TransactionSql } from "postgres"

import type { AnalyticsGranularity } from "@/lib/contracts/analytics"
import { visibilityPredicate } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

/**
 * The GET /api/analytics/overview reader, moved out of the route so the
 * /home server prefetch (lib/server/prefetch.ts) can call it directly. The
 * route is a thin wrapper around `loadAnalyticsOverview`; both produce the
 * same object, and the prefetch parses it through `analyticsOverviewSchema`
 * so it is byte-identical to what `fetchAnalyticsOverview` yields.
 */

type ReportWindow = { from: string; to: string }

type ProviderRow = {
  averageRating: number | null
  totalReviewCount: number | null
  localReviewCount: number
  localAverageRating: number | null
}

async function loadTimezone(sql: TransactionSql, organisationId: string) {
  const [organisation] = await sql<{ timezone: string }[]>`
    select default_timezone as timezone
    from organisation
    where id = ${organisationId}
  `
  return organisation?.timezone ?? "UTC"
}

async function loadSummary(
  sql: TransactionSql,
  session: Session,
  { from, to }: ReportWindow
) {
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
      and ${visibilityPredicate(sql, session, sql`r.location_id`)}
  `
  return summary
}

async function loadSeries(
  sql: TransactionSql,
  session: Session,
  { from, to }: ReportWindow,
  granularity: AnalyticsGranularity,
  timezone: string
) {
  const bucketInterval =
    granularity === "month"
      ? "1 month"
      : granularity === "week"
        ? "1 week"
        : "1 day"
  return sql`
    with buckets as (
      select generate_series(
        date_trunc(
          ${granularity},
          ${from}::timestamptz,
          ${timezone}
        ),
        date_trunc(
          ${granularity},
          ${to}::timestamptz,
          ${timezone}
        ),
        ${bucketInterval}::interval
      ) as period
    ),
    counted as (
      select
        date_trunc(
          ${granularity},
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
        and ${visibilityPredicate(sql, session, sql`r.location_id`)}
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
}

async function loadLocations(
  sql: TransactionSql,
  session: Session,
  { from, to }: ReportWindow
) {
  return sql`
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
      and ${visibilityPredicate(sql, session, sql`r.location_id`)}
    group by l.id, l.name
    order by "averageRating" desc
  `
}

async function loadProviderTotals(sql: TransactionSql, session: Session) {
  const [providerRow] = await sql<ProviderRow[]>`
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
          and ${visibilityPredicate(sql, session, sql`r.location_id`)}
      ) as "localReviewCount",
      (
        select avg(r.star_rating)::float
        from review r
        where r.provider_deleted_at is null
          and ${visibilityPredicate(sql, session, sql`r.location_id`)}
      ) as "localAverageRating"
    from external_location e
    join location_link ll
      on ll.external_location_id = e.id
     and ll.is_active = true
    where e.provider_totals_refreshed_at is not null
      and ${visibilityPredicate(sql, session, sql`ll.location_id`)}
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
  return {
    averageRating: providerRow.averageRating,
    totalReviewCount: providerRow.totalReviewCount,
    localReviewCount: providerRow.localReviewCount,
    divergence: countDivergence || ratingDivergence,
  }
}

export type AnalyticsOverviewWindow = {
  from?: string
  to?: string
  granularity: AnalyticsGranularity
}

/** Resolves the default 30-day window the same way the route always has. */
export function defaultReportWindow(now = Date.now()): ReportWindow {
  return {
    from: new Date(now - 30 * 86400000).toISOString(),
    to: new Date(now).toISOString(),
  }
}

export async function loadAnalyticsOverview(
  sql: TransactionSql,
  session: Session,
  query: AnalyticsOverviewWindow
) {
  const defaults = defaultReportWindow()
  const window: ReportWindow = {
    from: query.from ?? defaults.from,
    to: query.to ?? defaults.to,
  }
  const timezone = await loadTimezone(sql, session.organisationId)
  const summary = await loadSummary(sql, session, window)
  const series = await loadSeries(
    sql,
    session,
    window,
    query.granularity,
    timezone
  )
  const locations = await loadLocations(sql, session, window)
  const providerTotals = await loadProviderTotals(sql, session)
  return {
    from: window.from,
    to: window.to,
    timezone,
    summary,
    series,
    locations,
    providerTotals,
  }
}
