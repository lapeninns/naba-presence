import "server-only"

import type { Fragment, TransactionSql } from "postgres"

import type { ReviewTopic } from "@/lib/domain/review-topics"
import type {
  ReviewTopicReport,
  ReviewTopicReportQuery,
} from "@/lib/domain/review-topics-report"
import {
  computeTopicTrends,
  trendWeeks,
  type ClassifiedCountRow,
  type TopicCountRow,
} from "@/lib/domain/review-topics-trends"
import {
  visibilityPredicate,
  type ReportViewer,
} from "@/lib/server/permissions"

/**
 * The "What guests talk about" report (S3): topic share, negative share and
 * the weekly trend of classified reviews, for the group and each venue the
 * viewer can see, over the last 8 weeks by when the review was written.
 * Database only: nothing here calls the AI provider or Google. Counts only:
 * no review text or reviewer name leaves this function.
 */
export async function loadReviewTopicReport(
  sql: TransactionSql,
  viewer: ReportViewer,
  query: ReviewTopicReportQuery,
  now = new Date()
): Promise<ReviewTopicReport> {
  const weeks = trendWeeks(now)
  const from = weeks[0]
  const locations = await sql<{ id: string; name: string }[]>`
    select l.id::text as id, l.name
    from location l
    where ${visibilityPredicate(sql, viewer, sql`l.id`)}
      ${query.clientId ? sql`and l.client_id = ${query.clientId}` : sql``}
      ${query.locationId ? sql`and l.id = ${query.locationId}` : sql``}
      and exists (
        select 1 from review r
        where r.location_id = l.id and r.provider_deleted_at is null
      )
    order by l.name, l.id
  `
  const ids = locations.map((location) => location.id)
  if (ids.length === 0) {
    return {
      ...computeTopicTrends({
        now,
        locations: [],
        topicRows: [],
        classifiedRows: [],
      }),
      pendingReviews: 0,
    }
  }
  const scope = sql`
    r.location_id = any(${ids}::uuid[])
    and r.create_time >= (${from}::date)::timestamp at time zone 'UTC'
    and r.provider_deleted_at is null
    and r.erased_at is null
    -- A restricted review's processing has stopped: its labels stop counting.
    and r.restricted_at is null
  `
  const week = sql`to_char(date_trunc('week', r.create_time at time zone 'UTC'), 'YYYY-MM-DD')`
  const topicRows = await sql<TopicCountRow[]>`
    select
      r.location_id::text as "locationId",
      ${week} as week,
      t.topic,
      t.sentiment,
      count(*)::integer as count
    from review_topic t
    join review r on r.id = t.review_id
    -- Labels of the reviews counted below only: an edited review keeps its
    -- old labels, marked pending (markReviewTopicsStale), until it is
    -- classified again, and they must not count.
    join review_topic_classification c
      on c.review_id = t.review_id and c.status = 'classified'
    where ${scope}
    group by 1, 2, 3, 4
  `
  const classifiedRows = await sql<ClassifiedCountRow[]>`
    select
      r.location_id::text as "locationId",
      ${week} as week,
      count(*)::integer as reviews
    from review_topic_classification c
    join review r on r.id = c.review_id
    where c.status = 'classified' and ${scope}
    group by 1, 2
  `
  const [pending] = await sql<{ n: number }[]>`
    select count(*)::integer as n
    from review r
    left join review_topic_classification c on c.review_id = r.id
    where ${scope}
      and r.review_text is not null
      and btrim(r.review_text) <> ''
      and c.status is distinct from 'classified'
  `
  return {
    ...computeTopicTrends({ now, locations, topicRows, classifiedRows }),
    pendingReviews: pending?.n ?? 0,
  }
}

/**
 * The inbox's Topic filter (lib/server/reviews-query.ts buildInboxQuery):
 * reviews the classifier found talking about `topic`, in any sentiment.
 */
export function reviewTopicPredicate(
  sql: TransactionSql,
  topic: ReviewTopic | undefined
): Fragment {
  if (!topic) return sql``
  // Same rule as the report: only a current answer counts, so an edited
  // review waiting to be classified again, or a restricted one, drops out.
  return sql`and r.erased_at is null and r.restricted_at is null and exists (
    select 1 from review_topic rt
    join review_topic_classification rtc on rtc.review_id = rt.review_id
    where rt.review_id = r.id and rt.topic = ${topic}
      and rtc.status = 'classified'
  )`
}

/**
 * Marks a review's answer stale when Google supplied a different text
 * (lib/server/reviews.ts upsertGoogleReview), keyed on the hash of the text
 * the answer was for: the readers above count `classified` labels only, so
 * the old labels stop counting and the review shows as pending until the job
 * classifies the new text. Retention, which nulls the text, never comes
 * through here, so a redacted review keeps counting. Runs in the caller's
 * tenant transaction, after the review row is written.
 */
export async function markReviewTopicsStale(
  sql: TransactionSql,
  reviewId: string
): Promise<void> {
  await sql`
    update review_topic_classification c
    set status = 'pending', updated_at = now()
    from review r
    where c.review_id = ${reviewId}
      and r.id = c.review_id
      and c.status = 'classified'
      and r.review_text is not null
      and c.text_hash <> md5(r.review_text)
  `
}

/**
 * Forgets a review's topics, for a review whose text the reviewer removed
 * (lib/server/reviews.ts upsertGoogleReview). Runs in the caller's tenant
 * transaction.
 */
export async function clearReviewTopics(
  sql: TransactionSql,
  reviewId: string
): Promise<void> {
  await sql`delete from review_topic where review_id = ${reviewId}`
  await sql`
    delete from review_topic_classification where review_id = ${reviewId}
  `
}
