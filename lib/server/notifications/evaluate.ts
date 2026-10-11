import "server-only"

import type { TransactionSql } from "postgres"

import { withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { getAiCredits } from "@/lib/server/ai-credits"

import { runDeliveries, type DeliveryOutcome } from "./delivery"
import { sendTenantEmail } from "./email"
import { renderDigestEmail, renderIncidentEmail, type IncidentKind } from "./messages"
import { canSeeIncident, effectiveMode, loadNotificationMembers, loadPreferences, type ScopedIncident } from "./recipients"

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

type Finding = { subjectId: string; summary: Record<string, unknown>; locationId?: string | null }

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
        organisation_id, kind, subject_type, subject_id, summary, location_id
      )
      values (
        ${organisationId}, ${kind}, ${subjectType}, ${finding.subjectId},
        ${sql.json(JSON.parse(JSON.stringify(finding.summary)))},
        ${finding.locationId ?? null}
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

/**
 * Immediate email for everyone who can see a newly opened incident and has
 * immediate email for its kind (explicitly or by default). Digest choices are
 * collected later by buildDigests; the send re-checks access and preference.
 */
export async function queueDeliveries(
  sql: TransactionSql,
  organisationId: string,
  incidentIds: string[]
) {
  if (incidentIds.length === 0) return 0
  const incidents = await sql<ScopedIncident[]>`
    select id::text as id, kind, location_id::text as "locationId"
    from notification_incident where id in ${sql(incidentIds)}`
  const members = [...(await loadNotificationMembers(sql)).values()]
  const preferences = await loadPreferences(sql)
  let queued = 0
  for (const incident of incidents) {
    const recipients = members.filter((member) => canSeeIncident(member, incident) && effectiveMode(preferences, member, incident.kind, "email") === "immediate")
    if (!recipients.length) continue
    const rows = await sql`
      insert into notification_delivery (organisation_id, incident_id, recipient_user_id)
      select ${organisationId}, ${incident.id}, unnest(${recipients.map((member) => member.userId)}::uuid[])
      on conflict (incident_id, recipient_user_id, channel) do nothing
      returning id`
    queued += rows.length
  }
  return queued
}

/** Which credit incidents hold for this month's usage. Pure. */
export function creditUsageFindings(credits: {
  used: number
  allowance: number
  periodStart: string
  resetsAt: string
}): Record<"ai_credits_low" | "ai_credits_exhausted", Finding[]> {
  const none = { ai_credits_low: [], ai_credits_exhausted: [] }
  if (credits.allowance <= 0) return none
  const summary = {
    used: credits.used,
    allowance: credits.allowance,
    resetsOn: new Date(credits.resetsAt).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }),
  }
  const finding = { subjectId: credits.periodStart, summary }
  if (credits.used >= credits.allowance) {
    return { ai_credits_low: [], ai_credits_exhausted: [finding] }
  }
  if (credits.used * 100 >= credits.allowance * 80) {
    return { ai_credits_low: [finding], ai_credits_exhausted: [] }
  }
  return none
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
    const accessLost = await sql<{ subjectId: string; title: string; locationId: string }[]>`
      select e.id::text as "subjectId", e.title, ll.location_id::text as "locationId"
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
          locationId: row.locationId,
        }))
      )
    )

    // A listing whose reviews have not been checked successfully for the
    // threshold, on a login that is otherwise fine. A login waiting on a
    // reconnect, or a listing that lost access, already has its own
    // incident; a second one for the same cause would only be noise.
    const stale = await sql<
      { subjectId: string; title: string; lastSuccessAt: Date | null; locationId: string }[]
    >`
      select
        e.id::text as "subjectId",
        e.title,
        ll.location_id::text as "locationId",
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
          locationId: row.locationId,
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

    // The month's AI reply credits: a heads-up at 80%, a notice at 100%.
    // The period start is the subject, so each fires once per month; the
    // 80% incident resolves when the 100% one takes over. Only settled
    // credits count: a reservation can be released again, and a figure that
    // can fall would resolve and reopen the incident, emailing twice.
    const credits = await getAiCredits(sql, organisationId)
    const [settled] = await sql<{ used: number }[]>`
      select coalesce(sum(credits), 0)::integer as used
      from ai_usage
      where organisation_id = ${organisationId}
        and kind = 'draft'
        and status = 'settled'
        and period_start = ${credits.periodStart}::date
    `
    const creditFindings = creditUsageFindings({
      ...credits,
      used: settled?.used ?? 0,
    })
    for (const kind of ["ai_credits_low", "ai_credits_exhausted"] as const) {
      record(
        await syncIncidents(
          sql,
          organisationId,
          kind,
          "ai_credits",
          creditFindings[kind]
        )
      )
    }

    // New reviews of three stars or fewer. Events, not conditions: each is
    // recorded once (resolved at once) and announced once. Only reviews both
    // written and first seen in the last two days, so importing a listing's
    // history never floods anyone.
    const lowRated = await sql<{ id: string }[]>`
      insert into notification_incident (
        organisation_id, kind, subject_type, subject_id, status, resolved_at,
        summary, location_id
      )
      select
        r.organisation_id,
        'low_rating_review',
        'review',
        r.id::text,
        'resolved',
        now(),
        jsonb_build_object('rating', r.star_rating, 'title', e.title),
        ll.location_id
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

export type { DeliveryOutcome } from "./delivery"

type ClaimedDelivery = {
  id: string
  attempts: number
  createdAt: Date
  userId: string
  incidentId: string | null
  kind: string | null
  locationId: string | null
  summary: Record<string, unknown> | null
  digestIncidentIds: string[] | null
}

/**
 * Send what is due, through the shared driver (./delivery.ts): each delivery
 * is claimed (attempt counted, next attempt pushed out) in a committed write
 * BEFORE the provider is called, the settle afterwards is conditional on the
 * row still being pending, and every send carries the delivery's own
 * idempotency key, so a retry after a lost response cannot send twice.
 *
 * At send time the recipient must still be a member who can see the
 * incident's location and still want this email: a revoked member, a removed
 * location assignment or a changed preference suppresses it.
 */
export async function deliverPending(
  organisationId: string,
  limit = 50
): Promise<DeliveryOutcome> {
  const appUrl = getServerEnv().NEXTAUTH_URL ?? "http://localhost:3000"
  let claimed: ClaimedDelivery[] = []
  let context: Promise<{
    members: Awaited<ReturnType<typeof loadNotificationMembers>>
    preferences: Awaited<ReturnType<typeof loadPreferences>>
    digestIncidents: (ScopedIncident & { summary: Record<string, unknown> })[]
  }> | null = null
  const loadContext = () =>
    (context ??= withTenant(organisationId, async (sql) => {
      const digestIds = [...new Set(claimed.flatMap((delivery) => delivery.digestIncidentIds ?? []))]
      return {
        members: await loadNotificationMembers(sql),
        preferences: await loadPreferences(sql),
        digestIncidents: digestIds.length
          ? await sql<(ScopedIncident & { summary: Record<string, unknown> })[]>`
              select id::text as id, kind, location_id::text as "locationId", summary
              from notification_incident where id in ${sql(digestIds)}`
          : [],
      }
    }))
  return runDeliveries<ClaimedDelivery>({
    name: "notification_delivery",
    scopes: ["notifications"],
    claim: async () => {
      claimed = await withTenant(
        organisationId,
        (sql) =>
          sql<ClaimedDelivery[]>`
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
                next_attempt_at = now() + interval '10 minutes',
                idempotency_key = coalesce(d.idempotency_key, 'notification-delivery/' || d.id::text)
            from due
            where d.id = due.id
            returning d.id, d.attempts, d.created_at, d.incident_id, d.digest_id, d.recipient_user_id
          )
          select
            c.id::text as id,
            c.attempts,
            c.created_at as "createdAt",
            c.recipient_user_id::text as "userId",
            c.incident_id::text as "incidentId",
            i.kind,
            i.location_id::text as "locationId",
            i.summary,
            (select array_agg(x::text) from unnest(g.incident_ids) x) as "digestIncidentIds"
          from claimed c
          left join notification_incident i on i.id = c.incident_id
          left join notification_digest g on g.id = c.digest_id
        `
      )
      return claimed
    },
    send: async (delivery) => {
      const { members, preferences, digestIncidents } = await loadContext()
      const member = members.get(delivery.userId)
      if (!member) return { status: "suppressed", reason: "recipient_not_member" }
      if (!member.email) return { status: "suppressed", reason: "recipient_has_no_email" }
      let email: { subject: string; text: string }
      if (delivery.incidentId && delivery.kind) {
        const incident = { id: delivery.incidentId, kind: delivery.kind, locationId: delivery.locationId }
        if (!canSeeIncident(member, incident)) return { status: "suppressed", reason: "recipient_access_revoked" }
        if (effectiveMode(preferences, member, delivery.kind, "email") !== "immediate") return { status: "suppressed", reason: "recipient_preference_off" }
        email = renderIncidentEmail(delivery.kind as IncidentKind, delivery.summary ?? {}, appUrl)
      } else {
        const visible = digestIncidents.filter((incident) => (delivery.digestIncidentIds ?? []).includes(incident.id)
          && canSeeIncident(member, incident) && effectiveMode(preferences, member, incident.kind, "email") === "digest")
        if (!visible.length) return { status: "suppressed", reason: "digest_empty_after_recheck" }
        email = renderDigestEmail(visible, appUrl)
      }
      return sendTenantEmail({ to: member.email, ...email }, { idempotencyKey: `notification-delivery/${delivery.id}` })
    },
    // The send queue keeps `status`; `delivery_state` is the provider
    // evidence (0078), moved off `queued` once: an uncertain send is
    // `unknown`, never `failed`. Webhooks advance it from there.
    settle: (delivery, settlement) =>
      withTenant(
        organisationId,
        (sql) => sql`
        update notification_delivery
        set
          status = ${settlement.status},
          last_error_code = ${settlement.errorCode},
          provider_message_id = ${settlement.providerMessageId},
          sent_at = ${settlement.status === "sent" ? sql`now()` : null},
          delivery_state = case when delivery_state = 'queued' then ${settlement.evidence} else delivery_state end,
          delivery_state_at = case when delivery_state = 'queued' and ${settlement.evidence} <> 'queued' then now() else delivery_state_at end,
          next_attempt_at = ${
            settlement.retryInMinutes === null
              ? null
              : sql`now() + (${settlement.retryInMinutes} * interval '1 minute')`
          }
        where id = ${delivery.id}
          and status = 'pending'
      `
      ).then(() => undefined),
    logContext: () => ({ organisationId }),
  })
}


/** Local hour from which a day's digest is built. */
export const DIGEST_HOUR = 8

/**
 * One digest per recipient per local day (organisation timezone), holding the
 * unread incidents opened since that recipient's previous digest (or the last
 * 24 hours) whose kinds they chose to receive by digest. Unique per day, so
 * repeated cron runs build it once.
 */
export async function buildDigests(organisationId: string, now: Date = new Date()): Promise<number> {
  return withTenant(organisationId, async (sql) => {
    const [organisation] = await sql<{ timezone: string | null }[]>`select default_timezone as timezone from organisation limit 1`
    const timezone = organisation?.timezone || "Europe/London"
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(now).map((part) => [part.type, part.value]))
    if (Number(parts.hour) < DIGEST_HOUR) return 0
    const digestDate = `${parts.year}-${parts.month}-${parts.day}`
    const members = [...(await loadNotificationMembers(sql)).values()]
    const preferences = await loadPreferences(sql)
    let built = 0
    for (const member of members) {
      const [existing] = await sql`select 1 from notification_digest where user_id = ${member.userId} and digest_date = ${digestDate}::date`
      if (existing) continue
      const [previous] = await sql<{ createdAt: Date }[]>`select created_at as "createdAt" from notification_digest where user_id = ${member.userId} order by digest_date desc limit 1`
      const since = previous?.createdAt ?? new Date(now.getTime() - 86_400_000)
      const candidates = await sql<ScopedIncident[]>`
        select i.id::text as id, i.kind, i.location_id::text as "locationId"
        from notification_incident i
        where i.opened_at > ${since} and i.opened_at <= ${now}
          and not exists (select 1 from notification_recipient_state r where r.incident_id = i.id and r.user_id = ${member.userId})
        order by i.opened_at limit 200`
      const chosen = candidates.filter((incident) => canSeeIncident(member, incident) && effectiveMode(preferences, member, incident.kind, "email") === "digest")
      if (!chosen.length) continue
      const [digest] = await sql<{ id: string }[]>`
        insert into notification_digest (organisation_id, user_id, digest_date, incident_ids)
        values (${organisationId}, ${member.userId}, ${digestDate}::date, ${chosen.map((incident) => incident.id)}::uuid[])
        on conflict (organisation_id, user_id, digest_date) do nothing returning id::text as id`
      if (!digest) continue
      await sql`insert into notification_delivery (organisation_id, digest_id, recipient_user_id) values (${organisationId}, ${digest.id}, ${member.userId})`
      built += 1
    }
    return built
  })
}
