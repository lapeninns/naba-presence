import "server-only"

import type { TransactionSql } from "postgres"

import type { OperationalEvent } from "@/lib/contracts/operational-events"
import { localPostInputSchema } from "@/lib/contracts/location-posts"
import {
  contentExpired,
  eventOffsetsSchema,
  occurrenceEventDates,
  selectDueOccurrences,
} from "@/lib/domain/publication-schedule"
import { writeAudit } from "@/lib/server/audit"
import {
  getDatabase,
  jsonColumn,
  jsonColumnOrNull,
  withTenant,
} from "@/lib/server/db"
import { gbpWritesEnabled, getServerEnv } from "@/lib/server/env"
import { log } from "@/lib/server/logger"
import { recordOperationalEvent } from "@/lib/server/notifications/operational"
import { canPublishLocation } from "@/lib/server/permissions"
import { publishScheduledLocalPost } from "@/lib/server/posts"
import type { Session } from "@/lib/server/session"

type Schedule = {
  id: string
  organisationId: string
  locationId: string
  status: string
  revision: number
  timezone: string
  template: Record<string, unknown>
  eventOffsets: unknown
  requestedBy: string
  approvedBy: string | null
  approvedRevision: number | null
  requireTwoPersonApproval: boolean
}
type Due = { id: string; intendedAt: string; localDate: string }
export type ScheduleTickSummary = {
  schedules: number
  published: number
  rejected: number
  ambiguous: number
  missed: number
  blocked: number
}

function googleDate(date: string) {
  const [year, month, day] = date.split("-").map(Number)
  return { year, month, day }
}

/** The post body for one occurrence: the frozen template, with event dates moved by the frozen offsets. */
function occurrenceContent(schedule: Schedule, occurrence: Due) {
  const template = localPostInputSchema.parse(schedule.template)
  const offsets = schedule.eventOffsets
    ? eventOffsetsSchema.parse(schedule.eventOffsets)
    : null
  if (!offsets || !template.event)
    return { content: template, eventEndDate: eventEnd(template.event) }
  const dates = occurrenceEventDates(occurrence.localDate, offsets)
  const schedulePart = (template.event.schedule ?? {}) as Record<
    string,
    unknown
  >
  const event = {
    ...template.event,
    schedule: {
      ...schedulePart,
      startDate: googleDate(dates.startDate),
      endDate: googleDate(dates.endDate),
    },
  }
  return { content: { ...template, event }, eventEndDate: dates.endDate }
}
function eventEnd(event: Record<string, unknown> | undefined) {
  const end = (
    event?.schedule as
      { endDate?: { year?: number; month?: number; day?: number } } | undefined
  )?.endDate
  return end?.year && end.month && end.day
    ? `${end.year}-${String(end.month).padStart(2, "0")}-${String(end.day).padStart(2, "0")}`
    : null
}

async function emit(sql: TransactionSql, event: OperationalEvent) {
  try {
    await recordOperationalEvent(sql, event)
  } catch (error) {
    log.error("post_schedule.event_failed", { kind: event.kind, error })
  }
}
const base = (schedule: Schedule) => ({
  version: 1 as const,
  organisationId: schedule.organisationId,
  occurredAt: new Date().toISOString(),
  target: { type: "location" as const, locationId: schedule.locationId },
})

/** Checks that need a fresh approval when they fail. Null when the schedule may run. */
async function approvalProblem(
  sql: TransactionSql,
  schedule: Schedule
): Promise<"approval_invalid" | "permission_revoked" | null> {
  if (!schedule.approvedBy || schedule.approvedRevision !== schedule.revision)
    return "approval_invalid"
  const [policy] = await sql<
    { required: boolean }[]
  >`select require_two_person_approval as required from organisation limit 1`
  if ((policy?.required ?? false) !== schedule.requireTwoPersonApproval)
    return "approval_invalid"
  if (
    schedule.requireTwoPersonApproval &&
    schedule.approvedBy === schedule.requestedBy
  )
    return "approval_invalid"
  const [requester] =
    await sql`select 1 from member where user_id = ${schedule.requestedBy}`
  const [approver] = await sql<
    { role: Session["role"]; canPublish: boolean }[]
  >`select role, can_publish as "canPublish" from member where user_id = ${schedule.approvedBy}`
  if (!requester || !approver || !["owner", "admin"].includes(approver.role))
    return "permission_revoked"
  const session = {
    userId: schedule.approvedBy,
    role: approver.role,
    canPublish: approver.canPublish,
  }
  if (!(await canPublishLocation(sql, session, schedule.locationId)))
    return "permission_revoked"
  return null
}

async function approverSession(
  sql: TransactionSql,
  schedule: Schedule
): Promise<Session> {
  const [row] = await sql<
    {
      role: Session["role"]
      canPublish: boolean
      email: string
      displayName: string
      organisationName: string
    }[]
  >`
    select m.role, m.can_publish as "canPublish", u.email, coalesce(u.display_name, '') as "displayName", o.name as "organisationName"
    from member m join app_user u on u.id = m.user_id cross join organisation o where m.user_id = ${schedule.approvedBy}`
  return {
    sessionId: `post-schedule:${schedule.id}`,
    userId: schedule.approvedBy!,
    organisationId: schedule.organisationId,
    organisationName: row.organisationName,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    canPublish: row.canPublish,
  }
}

/** One claimed schedule: at most one publication per tick, never a resend of an unresolved one. */
export async function processSchedule(
  organisationId: string,
  scheduleId: string,
  requestId: string,
  now = new Date(),
  summary?: ScheduleTickSummary
) {
  const plan = await withTenant(organisationId, async (sql) => {
    const [schedule] = await sql<Schedule[]>`
      select id::text as id, organisation_id::text as "organisationId", location_id::text as "locationId", status, revision, timezone, template,
        event_offsets as "eventOffsets", requested_by::text as "requestedBy", approved_by::text as "approvedBy",
        approved_revision as "approvedRevision", require_two_person_approval as "requireTwoPersonApproval"
      from post_publication_schedule where id = ${scheduleId} for update`
    if (!schedule || schedule.status !== "active") return null
    const due = await sql<Due[]>`
      select id::text as id, to_char(intended_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "intendedAt", local_date::text as "localDate"
      from post_publication_occurrence
      where schedule_id = ${scheduleId} and schedule_revision = ${schedule.revision} and status = 'scheduled' and intended_at <= ${now}
      order by intended_at`
    const problem = await approvalProblem(sql, schedule)
    if (problem) {
      await sql`update post_publication_schedule set status = 'blocked', status_reason = ${problem}, updated_at = now() where id = ${scheduleId}`
      await emit(sql, {
        ...base(schedule),
        kind: "schedule_blocked",
        reason: problem,
        source: {
          type: "schedule_occurrence",
          id: due[0]?.id ?? scheduleId,
          scheduleId,
        },
      })
      if (summary) summary.blocked += 1
      return null
    }
    const env = getServerEnv()
    const [link] =
      await sql`select 1 from location_link ll join external_location e on e.id = ll.external_location_id
      join google_connection gc on gc.id = e.google_connection_id
      where ll.location_id = ${schedule.locationId} and ll.is_active and gc.status in ('active', 'expired')`
    const paused = !gbpWritesEnabled(env, "posts") || !env.PUBLISH_ENABLED
    if (paused || !link) {
      // Transient: the approval stands. Occurrences left waiting are marked
      // missed once they fall outside the grace period.
      await emit(sql, {
        ...base(schedule),
        kind: "schedule_blocked",
        reason: paused ? "publishing_paused" : "connection_unavailable",
        source: {
          type: "schedule_occurrence",
          id: due[0]?.id ?? scheduleId,
          scheduleId,
        },
      })
    }
    const { run, missed } = selectDueOccurrences(due, now)
    for (const occurrence of missed) {
      await sql`update post_publication_occurrence set status = 'missed', status_reason = 'outside_grace_period', finished_at = now() where id = ${occurrence.id} and status = 'scheduled'`
      await emit(sql, {
        ...base(schedule),
        kind: "schedule_missed",
        reason: "outside_grace_period",
        dueAt: occurrence.intendedAt,
        source: { type: "schedule_occurrence", id: occurrence.id, scheduleId },
      })
      if (summary) summary.missed += 1
    }
    if (!run || paused || !link) return { schedule, run: null }
    const { content, eventEndDate } = occurrenceContent(schedule, run)
    if (contentExpired(eventEndDate, now, schedule.timezone)) {
      await sql`update post_publication_occurrence set status = 'missed', status_reason = 'expired_content', finished_at = now() where id = ${run.id}`
      await emit(sql, {
        ...base(schedule),
        kind: "schedule_missed",
        reason: "expired_content",
        dueAt: run.intendedAt,
        source: { type: "schedule_occurrence", id: run.id, scheduleId },
      })
      if (summary) summary.missed += 1
      return { schedule, run: null }
    }
    // Claim the occurrence and create its own post in one transaction, so a
    // retried tick finds the same post (and the same publish idempotency key).
    const [external] = await sql<
      { id: string }[]
    >`select external_location_id::text as id from location_link where location_id = ${schedule.locationId} and is_active limit 1`
    const [post] = await sql<{ id: string }[]>`
      insert into gbp_local_post (organisation_id, location_id, external_location_id, topic_type, language_code, summary, call_to_action, event, offer, media, created_by)
      values (${organisationId}, ${schedule.locationId}, ${external.id}, ${content.topicType}, ${content.languageCode}, ${content.summary},
        ${jsonColumnOrNull(sql, content.callToAction)}, ${jsonColumnOrNull(sql, content.event)}, ${jsonColumnOrNull(sql, content.offer)}, ${jsonColumn(sql, content.media)}, ${schedule.requestedBy})
      returning id::text as id`
    const [claimed] =
      await sql`update post_publication_occurrence set status = 'publishing', started_at = now(), post_id = ${post.id}
      where id = ${run.id} and status = 'scheduled' returning id`
    if (!claimed) throw new Error("Occurrence claimed elsewhere")
    await writeAudit(sql, {
      organisationId,
      actorUserId: schedule.approvedBy!,
      action: "post_schedule.occurrence_started",
      subjectType: "post_schedule",
      subjectId: scheduleId,
      requestId,
      metadata: {
        occurrenceId: run.id,
        postId: post.id,
        intendedAt: run.intendedAt,
      },
    })
    return {
      schedule,
      run: { ...run, postId: post.id },
      session: await approverSession(sql, schedule),
    }
  })
  if (!plan?.run || !("session" in plan) || !plan.session) {
    await finish(organisationId, scheduleId)
    return
  }
  const { schedule, run, session } = plan
  let failure: unknown = null
  try {
    await publishScheduledLocalPost({
      organisationId,
      session,
      locationId: schedule.locationId,
      postId: run.postId,
      requestId,
    })
  } catch (error) {
    failure = error
  }
  await withTenant(organisationId, async (sql) => {
    const [post] = await sql<{ status: string; attemptId: string | null }[]>`
      select p.status, (select a.id::text from gbp_local_post_attempt a where a.post_id = p.id order by a.created_at desc limit 1) as "attemptId"
      from gbp_local_post p where p.id = ${run.postId}`
    const outcome =
      post?.status === "published"
        ? "published"
        : post?.status === "failed"
          ? "rejected"
          : "ambiguous"
    await sql`update post_publication_occurrence set status = ${outcome}, status_reason = ${outcome === "published" ? null : outcome === "rejected" ? "provider_rejected" : "response_ambiguous"}, finished_at = now() where id = ${run.id}`
    const attempt = post?.attemptId
    if (outcome === "rejected" && attempt) {
      await emit(sql, {
        ...base(schedule),
        kind: "publication_failed",
        reason: "provider_rejected",
        source: { type: "attempt", family: "posts", id: attempt },
      })
    }
    if (outcome === "ambiguous") {
      // Never resubmitted automatically: the schedule waits until someone
      // reads the post's saved outcome and resumes it.
      await sql`update post_publication_schedule set status = 'blocked', status_reason = 'prior_occurrence_unresolved', updated_at = now() where id = ${scheduleId}`
      if (attempt)
        await emit(sql, {
          ...base(schedule),
          kind: "publication_unresolved",
          reason: "response_ambiguous",
          source: { type: "attempt", family: "posts", id: attempt },
        })
      await emit(sql, {
        ...base(schedule),
        kind: "schedule_blocked",
        reason: "prior_occurrence_unresolved",
        source: { type: "schedule_occurrence", id: run.id, scheduleId },
      })
    }
    if (summary) summary[outcome] += 1
    if (failure && outcome !== "rejected")
      log.warn("post_schedule.publish_failed", {
        organisationId,
        scheduleId,
        occurrenceId: run.id,
        outcome,
      })
  })
  await finish(organisationId, scheduleId)
}

/** Releases the claim and completes a schedule with nothing left to run. */
async function finish(organisationId: string, scheduleId: string) {
  await withTenant(
    organisationId,
    (sql) => sql`
    update post_publication_schedule s set claim_lease_expires_at = null,
      status = case when s.status = 'active' and not exists (
        select 1 from post_publication_occurrence o where o.schedule_id = s.id and o.schedule_revision = s.revision and o.status in ('scheduled', 'publishing')
      ) then 'completed' else s.status end,
      updated_at = now()
    where s.id = ${scheduleId}`
  )
}

/** Called from the job runner tick while its budget lasts. */
export async function runDueSchedules(options: {
  budgetMs: number
  requestId: string
  now?: Date
}): Promise<ScheduleTickSummary> {
  const summary: ScheduleTickSummary = {
    schedules: 0,
    published: 0,
    rejected: 0,
    ambiguous: 0,
    missed: 0,
    blocked: 0,
  }
  const env = getServerEnv()
  const deadline = Date.now() + options.budgetMs
  while (Date.now() + env.GOOGLE_TIMEOUT_MS <= deadline) {
    const claimed = await getDatabase()<
      { organisationId: string; scheduleId: string }[]
    >`
      select organisation_id::text as "organisationId", schedule_id::text as "scheduleId"
      from claim_due_publication_schedules(${env.JOBS_BATCH_SIZE}, ${Math.ceil(options.budgetMs / 1000) + 60}, ${env.JOBS_PER_ORGANISATION})`
    if (!claimed.length) break
    for (const row of claimed) {
      summary.schedules += 1
      try {
        await processSchedule(
          row.organisationId,
          row.scheduleId,
          options.requestId,
          options.now ?? new Date(),
          summary
        )
      } catch (error) {
        log.error("post_schedule.process_failed", {
          organisationId: row.organisationId,
          scheduleId: row.scheduleId,
          error,
        })
        await finish(row.organisationId, row.scheduleId).catch(() => undefined)
      }
    }
  }
  return summary
}
