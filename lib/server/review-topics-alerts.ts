import "server-only"

import type { TransactionSql } from "postgres"

import { REVIEW_TOPIC_LABELS, isReviewTopic } from "@/lib/domain/review-topics"
import { isNegativeSpike, SPIKE_RULE } from "@/lib/domain/review-topics-trends"
import { withTenant } from "@/lib/server/db"
import { queueDeliveries } from "@/lib/server/notifications/evaluate"
import { isOrgFeatureEnabled } from "@/lib/server/org-features"

/**
 * The topic alert (S3): `review_topic_negative` for each venue and topic
 * whose negative share over the last 14 days is well above the venue's own
 * baseline for the 90 days before (isNegativeSpike). A condition kind,
 * re-derived on every health tick (app/api/cron/health/route.ts): one open
 * incident per venue and topic while the rule holds, so it is announced
 * once, and resolved when it stops holding. With the review_topics feature
 * off nothing holds, which resolves any open alert.
 *
 * Counts only: no review text or reviewer name reaches the incident.
 */

export const REVIEW_TOPIC_ALERT_KIND = "review_topic_negative"

/**
 * An alert that cleared is not raised again for the same venue and topic
 * within this many days, so a topic hovering at the threshold (a negative
 * review ageing out of the 14 days, another arriving) does not email on
 * every swing.
 */
export const REVIEW_TOPIC_ALERT_COOLDOWN_DAYS = 7

type Finding = {
  subjectId: string
  locationId: string
  summary: Record<string, unknown>
}

type CountRow = {
  locationId: string
  name: string
  topic: string
  recentMentions: number
  recentNegative: number
  baselineMentions: number
  baselineNegative: number
}

export async function reviewTopicSpikeFindings(
  sql: TransactionSql,
  organisationId: string
): Promise<Finding[]> {
  const recent = SPIKE_RULE.recentDays
  const oldest = SPIKE_RULE.recentDays + SPIKE_RULE.baselineDays
  const rows = await sql<CountRow[]>`
    select
      r.location_id::text as "locationId",
      l.name,
      t.topic,
      (count(*) filter (
        where r.create_time >= now() - make_interval(days => ${recent})
      ))::integer as "recentMentions",
      (count(*) filter (
        where r.create_time >= now() - make_interval(days => ${recent})
          and t.sentiment = 'negative'
      ))::integer as "recentNegative",
      (count(*) filter (
        where r.create_time < now() - make_interval(days => ${recent})
      ))::integer as "baselineMentions",
      (count(*) filter (
        where r.create_time < now() - make_interval(days => ${recent})
          and t.sentiment = 'negative'
      ))::integer as "baselineNegative"
    from review_topic t
    join review_topic_classification c
      on c.review_id = t.review_id and c.status = 'classified'
    join review r on r.id = t.review_id
    join location l on l.id = r.location_id
    where t.organisation_id = ${organisationId}
      and r.create_time >= now() - make_interval(days => ${oldest})
      and r.provider_deleted_at is null
      and r.erased_at is null
      -- A restricted review's processing has stopped: its labels stop
      -- counting. An edited one's are 'pending' until classified again.
      and r.restricted_at is null
    group by r.location_id, l.name, t.topic
    having (count(*) filter (
      where r.create_time >= now() - make_interval(days => ${recent})
        and t.sentiment = 'negative'
    )) >= ${SPIKE_RULE.minNegative}
    order by r.location_id, t.topic
  `
  return rows.flatMap((row) => {
    if (!isReviewTopic(row.topic) || !isNegativeSpike(row)) return []
    return [
      {
        subjectId: `${row.locationId}:${row.topic}`,
        locationId: row.locationId,
        summary: {
          title: `${REVIEW_TOPIC_LABELS[row.topic]} at ${row.name}`,
          locationId: row.locationId,
          topic: row.topic,
          recentNegative: row.recentNegative,
          recentMentions: row.recentMentions,
        },
      },
    ]
  })
}

/**
 * Opens an incident for each new finding, keeps the open ones current and
 * resolves those that no longer hold; queues immediate deliveries for the
 * newly opened ones. Runs in its own tenant transaction.
 */
export async function evaluateReviewTopicAlerts(
  organisationId: string
): Promise<{ opened: number; resolved: number; deliveriesQueued: number }> {
  return withTenant(organisationId, async (sql) => {
    const held = (await isOrgFeatureEnabled(
      sql,
      organisationId,
      "review_topics"
    ))
      ? await reviewTopicSpikeFindings(sql, organisationId)
      : []
    const recent = await sql<{ subjectId: string; open: boolean }[]>`
      select subject_id as "subjectId", bool_or(status = 'open') as open
      from notification_incident
      where organisation_id = ${organisationId}
        and kind = ${REVIEW_TOPIC_ALERT_KIND}
        and (
          status = 'open'
          or resolved_at > now() - make_interval(
            days => ${REVIEW_TOPIC_ALERT_COOLDOWN_DAYS}
          )
        )
      group by subject_id
    `
    const cooling = new Set(
      recent.filter((row) => !row.open).map((row) => row.subjectId)
    )
    const findings = held.filter((finding) => !cooling.has(finding.subjectId))
    const openedIds: string[] = []
    for (const finding of findings) {
      const [row] = await sql<{ id: string; inserted: boolean }[]>`
        insert into notification_incident (
          organisation_id, kind, subject_type, subject_id, summary, location_id
        )
        values (
          ${organisationId}, ${REVIEW_TOPIC_ALERT_KIND}, 'review_topic',
          ${finding.subjectId}, ${sql.json(JSON.parse(JSON.stringify(finding.summary)))},
          ${finding.locationId}
        )
        on conflict (organisation_id, kind, subject_id) where status = 'open'
        do update set last_seen_at = now(), summary = excluded.summary
        returning id::text as id, (xmax = 0) as inserted
      `
      if (row?.inserted) openedIds.push(row.id)
    }
    const current = findings.map((finding) => finding.subjectId)
    const resolved = await sql`
      update notification_incident
      set status = 'resolved', resolved_at = now()
      where organisation_id = ${organisationId}
        and kind = ${REVIEW_TOPIC_ALERT_KIND}
        and status = 'open'
        ${current.length ? sql`and subject_id not in ${sql(current)}` : sql``}
      returning id
    `
    const deliveriesQueued = await queueDeliveries(
      sql,
      organisationId,
      openedIds
    )
    return {
      opened: openedIds.length,
      resolved: resolved.length,
      deliveriesQueued,
    }
  })
}
