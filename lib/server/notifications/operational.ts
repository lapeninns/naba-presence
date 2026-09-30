import "server-only"

import type { TransactionSql } from "postgres"

import {
  OPERATIONAL_EVENT_POLICY,
  operationalEventSchema,
  operationalSubjectKey,
  type OperationalEvent,
} from "@/lib/contracts/operational-events"

import { queueDeliveries } from "./evaluate"

/**
 * Records one operational event inside the producer's tenant transaction.
 *
 * An event with an incident kind opens that incident once per subject key
 * (a repeat only moves last_seen_at, so re-reporting never re-notifies). A
 * confirming or recovering event resolves the matching open incident; it
 * never opens anything. Newly opened incidents queue immediate email for
 * recipients who can see them and chose immediate email.
 */
export async function recordOperationalEvent(
  sql: TransactionSql,
  input: OperationalEvent
) {
  const event = operationalEventSchema.parse(input)
  const policy = OPERATIONAL_EVENT_POLICY[event.kind]
  const subjectId = operationalSubjectKey(event)
  if (policy.resolves) {
    const resolved = await sql`
      update notification_incident set status = 'resolved', resolved_at = now()
      where kind = ${policy.resolves} and subject_id = ${subjectId} and status = 'open'
      returning id`
    return { opened: false, resolved: resolved.length }
  }
  if (!policy.incident) return { opened: false, resolved: 0 }
  const locationId =
    event.target.type === "location" ? event.target.locationId : null
  const [location] = locationId
    ? await sql<
        { name: string }[]
      >`select name from location where id = ${locationId}`
    : []
  const reason =
    "reason" in event ? event.reason : "state" in event ? event.state : null
  const summary = {
    title: location?.name ?? null,
    locationId,
    source: event.source,
    ...(event.kind === "bulk_completed_with_failures"
      ? {
          succeeded: event.succeeded,
          failed: event.failed,
          skipped: event.skipped,
        }
      : {}),
    ...(event.kind === "schedule_missed" ? { dueAt: event.dueAt } : {}),
  }
  const [row] = await sql<{ id: string; inserted: boolean }[]>`
    insert into notification_incident (organisation_id, kind, subject_type, subject_id, summary, location_id, reason, opened_at, last_seen_at)
    values (${event.organisationId}, ${policy.incident}, ${event.source.type}, ${subjectId}, ${sql.json(JSON.parse(JSON.stringify(summary)))},
      ${locationId}, ${reason}, ${event.occurredAt}, ${event.occurredAt})
    on conflict (organisation_id, kind, subject_id) where status = 'open'
    do update set last_seen_at = greatest(notification_incident.last_seen_at, excluded.last_seen_at), reason = excluded.reason
    returning id::text as id, (xmax = 0) as inserted`
  if (row?.inserted) await queueDeliveries(sql, event.organisationId, [row.id])
  return {
    opened: Boolean(row?.inserted),
    resolved: 0,
    incidentId: row?.id ?? null,
  }
}
