import "server-only"

import type { TransactionSql } from "postgres"

import { withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { log } from "@/lib/server/logger"

import { sendEmail } from "./email"
import { renderIncidentEmail, type IncidentKind } from "./messages"

/**
 * Turns an organisation's current state into incidents (0050), and new
 * incidents into deliveries for its owners and admins.
 *
 * Every rule is re-derived from the data on each run, so the evaluation is
 * idempotent: a problem still present keeps its one open incident (only
 * last_seen_at moves), a problem gone resolves it, and a problem that comes
 * back later is a new incident. Only a NEWLY opened incident queues
 * deliveries, and a delivery is unique per incident and recipient -- so a
 * retried evaluation, or one that runs every 15 minutes for a week, never
 * emails the same person twice about the same thing.
 *
 * Everything runs inside the organisation's tenant transaction, under RLS:
 * an evaluation can neither see nor notify another tenant.
 */

type Finding = { subjectId: string; summary: Record<string, unknown> }

export type OrganisationEvaluation = {
  opened: number
  resolved: number
  deliveriesQueued: number
}

async function syncIncidents(
  sql: TransactionSql,
  organisationId: string,
  kind: IncidentKind,
  subjectType: string,
  findings: Finding[]
): Promise<{ openedIds: string[]; resolved: number }> {
  const openedIds: string[] = []
  for (const finding of findings) {
    const [row] = await sql<{ id: string; inserted: boolean }[]>`
      insert into notification_incident (
        organisation_id, kind, subject_type, subject_id, summary
      )
      values (
        ${organisationId}, ${kind}, ${subjectType}, ${finding.subjectId},
        ${sql.json(JSON.parse(JSON.stringify(finding.summary)))}
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
    where kind = ${kind}
      and status = 'open'
      ${current.length ? sql`and subject_id not in ${sql(current)}` : sql``}
    returning id
  `
  return { openedIds, resolved: resolved.length }
}

/** Owners and admins at the time of queueing; the send re-checks. */
async function queueDeliveries(
  sql: TransactionSql,
  organisationId: string,
  incidentIds: string[]
) {
  if (incidentIds.length === 0) return 0
  const queued = await sql`
    insert into notification_delivery (organisation_id, incident_id, recipient_user_id)
    select ${organisationId}, i.id, m.user_id
    from notification_incident i
    cross join member m
    where i.id in ${sql(incidentIds)}
      and m.role in ('owner', 'admin')
    on conflict (incident_id, recipient_user_id, channel) do nothing
    returning id
  `
  return queued.length
}

const REVIEW_SYNC_TYPES = ["reconcile", "backfill", "sweep", "notification"]

export async function evaluateOrganisation(
  organisationId: string
): Promise<OrganisationEvaluation> {
  const staleHours = getServerEnv().LISTING_STALE_AFTER_HOURS
  return withTenant(organisationId, async (sql) => {
    let opened: string[] = []
    let resolved = 0
    const record = (result: { openedIds: string[]; resolved: number }) => {
      opened = opened.concat(result.openedIds)
      resolved += result.resolved
    }

    // A login a person must reconnect.
    const reconnect = await sql<
      { subjectId: string; googleEmail: string | null; reason: string | null }[]
    >`
      select distinct on (gc.id)
        gc.id::text as "subjectId",
        gc.google_email as "googleEmail",
        ct.reason_code as reason
      from google_connection gc
      join connection_task ct
        on ct.google_connection_id = gc.id
       and ct.task_type = 'reconnect'
       and ct.status = 'open'
      where gc.status <> 'disconnected'
      order by gc.id, ct.created_at desc
    `
    record(
      await syncIncidents(
        sql,
        organisationId,
        "connection_reconnect",
        "google_connection",
        reconnect.map((row) => ({
          subjectId: row.subjectId,
          summary: { googleEmail: row.googleEmail, reason: row.reason },
        }))
      )
    )

    // One listing the login can no longer reach.
    const accessLost = await sql<{ subjectId: string; title: string }[]>`
      select e.id::text as "subjectId", e.title
      from external_location e
      join location_link ll on ll.external_location_id = e.id and ll.is_active
      where e.access_state = 'access_lost'
    `
    record(
      await syncIncidents(
        sql,
        organisationId,
        "listing_access_lost",
        "external_location",
        accessLost.map((row) => ({
          subjectId: row.subjectId,
          summary: { title: row.title },
        }))
      )
    )

    // A listing whose reviews have not been checked successfully for the
    // threshold, on a login that is otherwise fine. A login waiting on a
    // reconnect, or a listing that lost access, already has its own
    // incident; a second one for the same cause would only be noise.
    const stale = await sql<
      { subjectId: string; title: string; lastSuccessAt: Date | null }[]
    >`
      select
        e.id::text as "subjectId",
        e.title,
        chk.last_success as "lastSuccessAt"
      from external_location e
      join location_link ll on ll.external_location_id = e.id and ll.is_active
      join google_connection gc on gc.id = e.google_connection_id
      left join lateral (
        select max(sc.last_succeeded_at) as last_success
        from sync_checkpoint sc
        where sc.external_location_id = e.id
          and sc.sync_type in ${sql(REVIEW_SYNC_TYPES)}
      ) chk on true
      where gc.status in ('active', 'expired')
        and e.access_state = 'ok'
        and not exists (
          select 1 from connection_task ct
          where ct.google_connection_id = gc.id
            and ct.task_type = 'reconnect'
            and ct.status = 'open'
        )
        and coalesce(chk.last_success, ll.created_at)
          < now() - (${staleHours} * interval '1 hour')
    `
    record(
      await syncIncidents(
        sql,
        organisationId,
        "listing_stale",
        "external_location",
        stale.map((row) => ({
          subjectId: row.subjectId,
          summary: {
            title: row.title,
            lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
            staleAfterHours: staleHours,
          },
        }))
      )
    )

    // The member who connected a working login has left the organisation.
    // The connection keeps running -- destroying a working connection
    // because its creator left would take every client on it offline -- but
    // an admin should move it onto a login the business controls.
    const orphaned = await sql<
      { subjectId: string; googleEmail: string | null }[]
    >`
      select gc.id::text as "subjectId", gc.google_email as "googleEmail"
      from google_connection gc
      where gc.status <> 'disconnected'
        and gc.connected_by_user_id is not null
        and not exists (
          select 1 from member m where m.user_id = gc.connected_by_user_id
        )
    `
    record(
      await syncIncidents(
        sql,
        organisationId,
        "connection_owner_left",
        "google_connection",
        orphaned.map((row) => ({
          subjectId: row.subjectId,
          summary: { googleEmail: row.googleEmail },
        }))
      )
    )

    // New reviews of three stars or fewer. Events, not conditions: each is
    // recorded once (resolved at once) and announced once. Only reviews both
    // written and first seen in the last two days, so importing a listing's
    // history never floods anyone.
    const lowRated = await sql<{ id: string }[]>`
      insert into notification_incident (
        organisation_id, kind, subject_type, subject_id, status, resolved_at,
        summary
      )
      select
        r.organisation_id,
        'low_rating_review',
        'review',
        r.id::text,
        'resolved',
        now(),
        jsonb_build_object('rating', r.star_rating, 'title', e.title)
      from review r
      join external_location e on e.id = r.external_location_id
      join location_link ll on ll.external_location_id = e.id and ll.is_active
      where r.star_rating <= 3
        and r.provider_deleted_at is null
        and r.create_time >= now() - interval '48 hours'
        and r.created_at >= now() - interval '48 hours'
      order by r.create_time desc
      limit 20
      on conflict (organisation_id, subject_id) where kind = 'low_rating_review'
      do nothing
      returning id::text as id
    `
    opened = opened.concat(lowRated.map((row) => row.id))

    const deliveriesQueued = await queueDeliveries(sql, organisationId, opened)
    return { opened: opened.length, resolved, deliveriesQueued }
  })
}

const MAX_DELIVERY_ATTEMPTS = 5

export type DeliveryOutcome = {
  sent: number
  suppressed: number
  failed: number
}

/**
 * Send what is due. Each delivery is claimed (attempt counted, next attempt
 * pushed out) in a committed write BEFORE the provider is called, so a crash
 * mid-send can at worst delay a retry, never send twice in the same run; the
 * settle afterwards is conditional on the row still being pending.
 */
export async function deliverPending(
  organisationId: string,
  limit = 50
): Promise<DeliveryOutcome> {
  const outcome: DeliveryOutcome = { sent: 0, suppressed: 0, failed: 0 }
  const appUrl = getServerEnv().NEXTAUTH_URL ?? "http://localhost:3000"
  const claimed = await withTenant(
    organisationId,
    (sql) =>
      sql<
        {
          id: string
          attempts: number
          kind: IncidentKind
          summary: Record<string, unknown>
          email: string | null
          stillAdmin: boolean
        }[]
      >`
      with due as (
        select d.id
        from notification_delivery d
        where d.status = 'pending'
          and d.next_attempt_at <= now()
        order by d.next_attempt_at
        limit ${limit}
        for update skip locked
      ),
      claimed as (
        update notification_delivery d
        set attempts = d.attempts + 1,
            next_attempt_at = now() + interval '10 minutes'
        from due
        where d.id = due.id
        returning d.id, d.attempts, d.incident_id, d.recipient_user_id
      )
      select
        c.id::text as id,
        c.attempts,
        i.kind,
        i.summary,
        u.email,
        exists (
          select 1 from member m
          where m.user_id = c.recipient_user_id
            and m.role in ('owner', 'admin')
        ) as "stillAdmin"
      from claimed c
      join notification_incident i on i.id = c.incident_id
      left join app_user u on u.id = c.recipient_user_id
    `
  )
  for (const delivery of claimed) {
    let status: "sent" | "suppressed" | "failed" | "pending"
    let errorCode: string | null = null
    let providerMessageId: string | null = null
    if (!delivery.stillAdmin || !delivery.email) {
      status = "suppressed"
      errorCode = delivery.stillAdmin
        ? "recipient_has_no_email"
        : "recipient_not_admin"
    } else {
      const message = renderIncidentEmail(
        delivery.kind,
        delivery.summary,
        appUrl
      )
      const result = await sendEmail({ to: delivery.email, ...message })
      if (result.status === "sent") {
        status = "sent"
        providerMessageId = result.providerMessageId
      } else if (result.status === "suppressed") {
        status = "suppressed"
        errorCode = result.reason
      } else {
        errorCode = result.code
        status =
          result.retryable && delivery.attempts < MAX_DELIVERY_ATTEMPTS
            ? "pending"
            : "failed"
      }
    }
    outcome[status === "pending" ? "failed" : status] += 1
    await withTenant(
      organisationId,
      (sql) => sql`
      update notification_delivery
      set
        status = ${status},
        last_error_code = ${errorCode},
        provider_message_id = ${providerMessageId},
        sent_at = ${status === "sent" ? sql`now()` : null},
        next_attempt_at = ${
          status === "pending"
            ? sql`now() + (${2 ** delivery.attempts} * interval '1 minute')`
            : null
        }
      where id = ${delivery.id}
        and status = 'pending'
    `
    )
    if (status === "failed" || status === "pending") {
      log.warn("notifications.delivery_failed", {
        organisationId,
        deliveryId: delivery.id,
        errorCode,
        willRetry: status === "pending",
      })
    }
  }
  return outcome
}
