import "server-only"

import { getDatabase } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { log } from "@/lib/server/logger"
import {
  schedulerLiveness,
  tickFindings,
  type TickFinding,
} from "@/lib/server/ops-liveness"

import { sendEmail } from "./email"
import { renderPlatformEmail } from "./messages"

export type PlatformIncidentKind =
  | TickFinding["kind"]
  | "google_quota_pressure"

const PLATFORM_INCIDENT_KINDS: readonly PlatformIncidentKind[] = [
  "stale_heartbeat",
  "tick_never_completed",
  "tick_lock_wedged",
  "tick_cycle_overdue",
  "google_quota_pressure",
]

type PlatformFinding = {
  kind: PlatformIncidentKind
  subject: string
  details: Record<string, unknown>
}

export type PlatformEvaluation = {
  opened: number
  resolved: number
  notified: number
}

/**
 * Infrastructure incidents for operators (platform_incident, 0050): a
 * scheduled tick that has stopped completing, and sustained Google rate
 * limiting. Platform-level like ops_heartbeat, so read outside withTenant.
 *
 * Tick findings come from the run ledger (ops-liveness.ts tickFindings): a
 * tick that used to complete and stopped, one that has never completed past
 * the grace from its registration (0070), a lease wedged by repeated lock
 * skips, and a multi-run tick that has not finished a cycle in its window.
 * Only scheduled runs count; a manual refresh under the same lease does not.
 */
export async function evaluatePlatform(): Promise<PlatformEvaluation> {
  const database = getDatabase()
  const now = new Date()
  const liveness = await schedulerLiveness(now)
  const findings: PlatformFinding[] = tickFindings(
    liveness.schedulerTicks,
    now
  )
  const throttled = await database<
    { bucket: string; throttledCount: number }[]
  >`
    select bucket, throttled_count as "throttledCount"
    from google_rate_bucket
    where last_throttled_at >= now() - interval '15 minutes'
      and bucket not like 'edit:%'
  `
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

  let notified = 0
  const recipients = getServerEnv().OPS_ALERT_EMAILS
  for (const { id, finding } of opened) {
    const message = renderPlatformEmail(
      finding.kind,
      finding.subject,
      finding.details
    )
    let status: "sent" | "failed" | "suppressed" = "suppressed"
    let error: string | null = recipients.length ? null : "no_ops_recipients"
    for (const to of recipients) {
      const result = await sendEmail({ to, ...message })
      if (result.status === "sent") {
        status = "sent"
        notified += 1
      } else if (result.status === "failed") {
        if (status !== "sent") status = "failed"
        error = result.code
      } else {
        error = result.reason
      }
    }
    // Recorded on the incident: the operations endpoint and the log are the
    // fallback when no one could be emailed.
    await database`
      update platform_incident
      set notify_status = ${status}, notified_at = now(), notify_error = ${error}
      where id = ${id}
    `
    log[status === "sent" ? "warn" : "error"]("ops.platform_incident_opened", {
      kind: finding.kind,
      subject: finding.subject,
      notifyStatus: status,
    })
  }
  return { opened: opened.length, resolved, notified }
}
