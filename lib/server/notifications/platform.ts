import "server-only"

import { getDatabase } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { log } from "@/lib/server/logger"
import {
  scheduledPostHealth,
  schedulerLiveness,
  tickFindings,
  type ScheduledPostFinding,
  type TickFinding,
} from "@/lib/server/ops-liveness"
import { retentionCycleFailureFinding } from "@/lib/server/retention/cycle"

import { runDeliveries, type DeliveryOutcome } from "./delivery"
import { sendEmail } from "./email"
import { renderPlatformEmail } from "./messages"

export type PlatformIncidentKind =
  | TickFinding["kind"]
  | ScheduledPostFinding["kind"]
  | "google_quota_pressure"

const PLATFORM_INCIDENT_KINDS: readonly PlatformIncidentKind[] = [
  "stale_heartbeat",
  "tick_never_completed",
  "tick_lock_wedged",
  "tick_cycle_overdue",
  "tick_cycle_failures",
  "google_quota_pressure",
  "scheduled_post_stuck",
  "scheduled_post_overdue",
]

type PlatformFinding = {
  kind: PlatformIncidentKind
  subject: string
  details: Record<string, unknown>
}

export type PlatformEvaluation = {
  opened: number
  resolved: number
  /** Operator alerts the provider accepted on this run. */
  notified: number
  delivery: DeliveryOutcome
}

/**
 * Infrastructure incidents for operators (platform_incident, 0050): a
 * scheduled tick that has stopped completing, and sustained Google rate
 * limiting. Platform-level like ops_heartbeat, so read outside withTenant.
 *
 * Tick findings come from the run ledger (ops-liveness.ts tickFindings): a
 * tick that used to complete and stopped, one that has never completed past
 * the grace from its registration (0089), a lease wedged by repeated lock
 * skips, and a multi-run tick that has not finished a cycle in its window.
 * Only scheduled runs count; a manual refresh under the same lease does not.
 * A cycle that completed with organisations it could not retain is its own
 * finding (retentionCycleFailureFinding): completing stamps the ledger, so
 * the overdue check never sees a tenant that fails every day.
 *
 * Scheduled post findings (P08-R6, ops-liveness.ts scheduledPostHealth) are
 * per organisation: an occurrence stuck `publishing` past its lease, or
 * still `scheduled` three minutes past its deadline. They report only; nothing
 * here publishes, resends or settles an occurrence.
 */
export async function evaluatePlatform(): Promise<PlatformEvaluation> {
  const database = getDatabase()
  const now = new Date()
  const liveness = await schedulerLiveness(now)
  const findings: PlatformFinding[] = tickFindings(liveness.schedulerTicks, now)
  const cycleFailures = await retentionCycleFailureFinding()
  if (cycleFailures) findings.push(cycleFailures)
  const throttled = await database<
    { bucket: string; throttledCount: number }[]
  >`
    select bucket, throttled_count as "throttledCount"
    from google_rate_bucket
    where last_throttled_at >= now() - interval '15 minutes'
      and bucket not like 'edit:%'
  `
  // A failed read must not stop the tick alerts, nor resolve open scheduled
  // post incidents it could not check: their kinds are left as they are.
  const unchecked = new Set<PlatformIncidentKind>()
  try {
    findings.push(...(await scheduledPostHealth()))
  } catch (error) {
    unchecked.add("scheduled_post_stuck").add("scheduled_post_overdue")
    log.error("ops.scheduled_post_health_failed", { error })
  }
  for (const row of throttled) {
    findings.push({
      kind: "google_quota_pressure",
      subject: row.bucket,
      details: { throttledCount: row.throttledCount },
    })
  }

  const opened: { id: string; finding: PlatformFinding }[] = []
  for (const finding of findings) {
    const [row] = await database<{ id: string; inserted: boolean }[]>`
      insert into platform_incident (kind, subject, details)
      values (
        ${finding.kind}, ${finding.subject},
        ${database.json(JSON.parse(JSON.stringify(finding.details)))}
      )
      on conflict (kind, subject) where status = 'open'
      do update set last_seen_at = now(), details = excluded.details
      returning id::text as id, (xmax = 0) as inserted
    `
    if (row?.inserted) opened.push({ id: row.id, finding })
  }
  let resolved = 0
  for (const kind of PLATFORM_INCIDENT_KINDS) {
    if (unchecked.has(kind)) continue
    const current = findings
      .filter((finding) => finding.kind === kind)
      .map((finding) => finding.subject)
    const rows = await database`
      update platform_incident
      set status = 'resolved', resolved_at = now()
      where kind = ${kind}
        and status = 'open'
        ${current.length ? database`and subject not in ${database(current)}` : database``}
      returning id
    `
    resolved += rows.length
  }

  // One delivery per opened incident and recipient. With no recipients the
  // incident records why nobody was emailed: the operations endpoint and the
  // log are then the only signal.
  const recipients = getServerEnv().OPS_ALERT_EMAILS
  for (const { id, finding } of opened) {
    if (recipients.length) {
      await database`
        insert into platform_incident_delivery (incident_id, recipient)
        select ${id}, unnest(${recipients}::text[])
        on conflict (incident_id, recipient, channel) do nothing
      `
    } else {
      await database`
        update platform_incident
        set notify_status = 'suppressed', notified_at = now(),
            notify_error = 'no_ops_recipients'
        where id = ${id}
      `
    }
    log[recipients.length ? "warn" : "error"]("ops.platform_incident_opened", {
      kind: finding.kind,
      subject: finding.subject,
      recipients: recipients.length,
    })
  }
  const delivery = await deliverPlatformPending()
  return {
    opened: opened.length,
    resolved,
    notified: delivery.sent,
    delivery,
  }
}

type ClaimedPlatformDelivery = {
  id: string
  attempts: number
  createdAt: Date
  mayHaveSent: boolean
  incidentId: string
  recipient: string
  kind: PlatformIncidentKind
  subject: string
  details: Record<string, unknown>
  incidentStatus: "open" | "resolved"
}

/**
 * Sends due operator alerts through the shared driver: claimed before the
 * send, retried with back-off, never sent twice (each row's idempotency key),
 * and a timeout recorded uncertain rather than failed. An incident that
 * resolved before its alert went out is suppressed: telling on-call a tick
 * "has stopped" after it recovered is noise.
 *
 * Each settle also refreshes the incident's notify_status summary (0050's
 * columns, kept for rollback): sent once any recipient was sent, failed once
 * every recipient is settled without a send (uncertain counts as failed
 * there, as that column has no such state), suppressed when all were.
 */
export async function deliverPlatformPending(
  limit = 50
): Promise<DeliveryOutcome> {
  const database = getDatabase()
  return runDeliveries<ClaimedPlatformDelivery>({
    name: "platform_incident_delivery",
    scopes: ["notifications"],
    claim: () =>
      database<ClaimedPlatformDelivery[]>`
        with due as (
          select d.id
          from platform_incident_delivery d
          where d.status = 'pending'
            and d.next_attempt_at <= now()
          order by d.next_attempt_at
          limit ${limit}
          for update skip locked
        ),
        claimed as (
          update platform_incident_delivery d
          set attempts = d.attempts + 1,
              next_attempt_at = now() + interval '10 minutes'
          from due
          where d.id = due.id
          returning d.id, d.attempts, d.created_at, d.may_have_sent, d.incident_id, d.recipient
        )
        select
          c.id::text as id,
          c.attempts,
          c.created_at as "createdAt",
          c.may_have_sent as "mayHaveSent",
          c.incident_id::text as "incidentId",
          c.recipient,
          i.kind,
          i.subject,
          i.details,
          i.status as "incidentStatus"
        from claimed c
        join platform_incident i on i.id = c.incident_id
      `,
    send: (delivery) => {
      if (delivery.incidentStatus !== "open") {
        return Promise.resolve({
          status: "suppressed",
          reason: "incident_resolved",
        })
      }
      return sendEmail(
        {
          to: delivery.recipient,
          ...renderPlatformEmail(
            delivery.kind,
            delivery.subject,
            delivery.details ?? {}
          ),
        },
        { idempotencyKey: `platform-incident-delivery/${delivery.id}` }
      )
    },
    settle: async (delivery, settlement) => {
      await database`
        update platform_incident_delivery
        set
          status = ${settlement.status},
          last_error_code = ${settlement.errorCode},
          may_have_sent = may_have_sent or ${settlement.mayHaveSent},
          provider_message_id = ${settlement.providerMessageId},
          sent_at = ${settlement.status === "sent" ? database`now()` : null},
          next_attempt_at = ${
            settlement.retryInMinutes === null
              ? null
              : database`now() + (${settlement.retryInMinutes} * interval '1 minute')`
          }
        where id = ${delivery.id}
          and status = 'pending'
      `
      await database`
        update platform_incident i
        set notify_status = s.notify_status,
            notified_at = now(),
            notify_error = s.notify_error
        from (
          select
            case
              when bool_or(status = 'sent') then 'sent'
              when bool_or(status = 'pending') then null
              when bool_or(status in ('failed', 'uncertain')) then 'failed'
              else 'suppressed'
            end as notify_status,
            (array_agg(last_error_code order by last_error_code)
              filter (where status <> 'sent' and last_error_code is not null))[1]
              as notify_error
          from platform_incident_delivery
          where incident_id = ${delivery.incidentId}
        ) s
        where i.id = ${delivery.incidentId}
          and s.notify_status is not null
      `
    },
    logContext: (delivery) => ({
      incidentId: delivery.incidentId,
      kind: delivery.kind,
    }),
  })
}
