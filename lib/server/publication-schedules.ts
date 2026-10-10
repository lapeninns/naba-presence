import "server-only"

import type { TransactionSql } from "postgres"
import type { z } from "zod"

import {
  occurrencesResponseSchema,
  scheduleSchema,
  type occurrencesQuerySchema,
  type PublicationSchedule,
  type ScheduleDraft,
  type scheduleRevisionSchema,
} from "@/lib/contracts/publication-schedules"
import { localPostInputSchema } from "@/lib/contracts/location-posts"
import {
  DEFAULT_SCHEDULE_TIMEZONE,
  eventOffsetsSchema,
  expandSchedule,
  scheduleRuleSchema,
  type ScheduleRule,
} from "@/lib/domain/publication-schedule"
import { writeAudit } from "@/lib/server/audit"
import { jsonColumn, jsonColumnOrNull, withTenant } from "@/lib/server/db"
import { stableGoogleHash } from "@/lib/server/gbp-management"
import { ApiError } from "@/lib/server/http"
import {
  canPublishLocation,
  isManagerialRole,
  requireLocationAccess,
  visibilityPredicate,
} from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

type Row = {
  id: string
  locationId: string
  locationName: string
  status: PublicationSchedule["status"]
  statusReason: string | null
  revision: number
  payloadHash: string
  rule: unknown
  timezone: string
  eventOffsets: unknown
  template: Record<string, unknown>
  sourcePostId: string | null
  requestedBy: string
  approvedBy: string | null
  approvedAt: Date | null
  approvedRevision: number | null
  requireTwoPersonApproval: boolean
}
const NOT_FOUND = {
  code: "schedule_not_found",
  message: "The schedule was not found.",
}

/** The content, rule, zone, offsets and target that one approval covers. */
export function schedulePayloadHash(input: {
  locationId: string
  template: unknown
  rule: ScheduleRule
  timezone: string
  eventOffsets: unknown
}) {
  return stableGoogleHash({
    locationId: input.locationId,
    template: input.template,
    rule: input.rule,
    timezone: input.timezone,
    eventOffsets: input.eventOffsets ?? null,
  })
}

async function loadRow(
  sql: TransactionSql,
  locationId: string,
  scheduleId: string,
  lock = false
) {
  const [row] = await sql<Row[]>`
    select s.id::text as id, s.location_id::text as "locationId", l.name as "locationName", s.status, s.status_reason as "statusReason",
      s.revision, s.payload_hash as "payloadHash", s.rule, s.timezone, s.event_offsets as "eventOffsets", s.template,
      s.source_post_id::text as "sourcePostId", s.requested_by::text as "requestedBy", s.approved_by::text as "approvedBy",
      s.approved_at as "approvedAt", s.approved_revision as "approvedRevision", s.require_two_person_approval as "requireTwoPersonApproval"
    from post_publication_schedule s join location l on l.id = s.location_id
    where s.id = ${scheduleId} and s.location_id = ${locationId}
    ${lock ? sql`for update of s` : sql``}`
  if (!row) throw new ApiError(404, NOT_FOUND.code, NOT_FOUND.message)
  return row
}

async function project(
  sql: TransactionSql,
  session: Session,
  row: Row
): Promise<PublicationSchedule> {
  const rule = scheduleRuleSchema.parse(row.rule)
  const expansion = expandSchedule(rule, row.timezone)
  const counts = await sql<{ status: string; count: number }[]>`
    select status, count(*)::int as count from post_publication_occurrence where schedule_id = ${row.id} and schedule_revision = ${row.revision} group by status`
  return scheduleSchema.parse({
    ...row,
    rule,
    eventOffsets: row.eventOffsets ?? null,
    template: {
      ...row.template,
      topicType: String(row.template.topicType ?? ""),
      summary: String(row.template.summary ?? ""),
    },
    approvedAt: row.approvedAt?.toISOString() ?? null,
    requiresSecondApprover: row.requireTwoPersonApproval,
    canApprove:
      isManagerialRole(session.role) &&
      row.status === "awaiting_approval" &&
      (!row.requireTwoPersonApproval || row.requestedBy !== session.userId),
    preview: {
      total: expansion.occurrences.length,
      first: expansion.occurrences.slice(0, 12),
      skippedDates: expansion.skippedDates,
      adjusted: expansion.occurrences.filter(
        (occurrence) => occurrence.adjustment !== "none"
      ).length,
    },
    counts: Object.fromEntries(counts.map((row) => [row.status, row.count])),
  })
}

async function requireCurrentManager(
  sql: TransactionSql,
  userId: string,
  code = "approval_actor_access_changed"
) {
  const [member] = await sql<
    { role: string }[]
  >`select role from member where user_id = ${userId}`
  if (!member || !["owner", "admin"].includes(member.role))
    throw new ApiError(
      409,
      code,
      "An initiating or approving user's access changed. The schedule needs a fresh approval."
    )
}

async function frozenTemplate(
  sql: TransactionSql,
  locationId: string,
  postId: string
) {
  const [post] = await sql<Array<Record<string, unknown> & { status: string }>>`
    select topic_type as "topicType", language_code as "languageCode", summary, call_to_action as "callToAction",
      event, offer, media, status
    from gbp_local_post where id = ${postId} and location_id = ${locationId} and status <> 'deleted'`
  if (!post) throw new ApiError(404, "post_not_found", "Post not found.")
  const { status: _status, ...content } = post
  void _status
  const parsed = localPostInputSchema.safeParse(
    Object.fromEntries(
      Object.entries(content).filter(([, value]) => value !== null)
    )
  )
  if (!parsed.success)
    throw new ApiError(
      422,
      "schedule_content_invalid",
      "Finish the post before scheduling it."
    )
  return parsed.data
}

function validateShape(
  template: z.infer<typeof localPostInputSchema>,
  rule: ScheduleRule,
  eventOffsets: unknown
) {
  const dated = template.topicType === "EVENT" || template.topicType === "OFFER"
  if (!dated && eventOffsets)
    throw new ApiError(
      422,
      "schedule_offsets_not_applicable",
      "Only event and offer posts have event dates to move."
    )
  if (dated && rule.frequency !== "once" && !eventOffsets) {
    throw new ApiError(
      422,
      "schedule_offsets_required",
      "A repeating event or offer needs its dates set relative to each publication."
    )
  }
  if (eventOffsets) eventOffsetsSchema.parse(eventOffsets)
}

function futureOccurrences(
  rule: ScheduleRule,
  timezone: string,
  now = new Date()
) {
  const expansion = expandSchedule(rule, timezone)
  return expansion.occurrences.filter(
    (occurrence) => Date.parse(occurrence.intendedAt) > now.getTime()
  )
}

export async function createPublicationSchedule(
  session: Session,
  locationId: string,
  draft: ScheduleDraft,
  requestId: string
) {
  return withTenant(session.organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId, NOT_FOUND)
    if (session.role === "viewer")
      throw new ApiError(403, "forbidden", "Viewers cannot schedule posts.")
    const [location] = await sql<
      { timezone: string | null }[]
    >`select timezone from location where id = ${locationId}`
    const timezone =
      draft.timezone ?? location?.timezone ?? DEFAULT_SCHEDULE_TIMEZONE
    const template = await frozenTemplate(sql, locationId, draft.postId)
    validateShape(template, draft.rule, draft.eventOffsets)
    if (!futureOccurrences(draft.rule, timezone).length)
      throw new ApiError(
        422,
        "schedule_in_past",
        "Every publication time in this schedule has already passed."
      )
    const [policy] = await sql<
      { required: boolean }[]
    >`select require_two_person_approval as required from organisation limit 1`
    const payloadHash = schedulePayloadHash({
      locationId,
      template,
      rule: draft.rule,
      timezone,
      eventOffsets: draft.eventOffsets,
    })
    const [created] = await sql<{ id: string }[]>`
      insert into post_publication_schedule (organisation_id, location_id, source_post_id, template, event_offsets, rule, timezone, payload_hash, requested_by, require_two_person_approval)
      values (${session.organisationId}, ${locationId}, ${draft.postId}, ${jsonColumn(sql, template)}, ${jsonColumnOrNull(sql, draft.eventOffsets)},
        ${jsonColumn(sql, draft.rule)}, ${timezone}, ${payloadHash}, ${session.userId}, ${policy?.required ?? false})
      returning id::text as id`
    await writeAudit(sql, {
      organisationId: session.organisationId,
      actorUserId: session.userId,
      action: "post_schedule.requested",
      subjectType: "post_schedule",
      subjectId: created.id,
      requestId,
      metadata: { locationId, payloadHash },
    })
    return project(sql, session, await loadRow(sql, locationId, created.id))
  })
}

export async function listPublicationSchedules(
  session: Session,
  locationId: string
) {
  return withTenant(session.organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId, NOT_FOUND)
    const ids = await sql<
      { id: string }[]
    >`select id::text as id from post_publication_schedule where location_id = ${locationId} order by created_at desc limit 50`
    return Promise.all(
      ids.map(async ({ id }) =>
        project(sql, session, await loadRow(sql, locationId, id))
      )
    )
  })
}

/** Approves one exact revision and materialises its future occurrences once. */
export async function approvePublicationSchedule(
  session: Session,
  locationId: string,
  scheduleId: string,
  input: { expectedPayloadHash: string; revision: number },
  requestId: string
) {
  return withTenant(session.organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId, NOT_FOUND)
    if (
      !isManagerialRole(session.role) ||
      !(await canPublishLocation(sql, session, locationId))
    )
      throw new ApiError(
        403,
        "publish_not_allowed",
        "Only an owner or administrator who can publish here can approve a schedule."
      )
    const row = await loadRow(sql, locationId, scheduleId, true)
    if (row.status !== "awaiting_approval")
      throw new ApiError(
        409,
        "schedule_not_awaiting_approval",
        "This schedule is not waiting for approval."
      )
    if (
      row.revision !== input.revision ||
      row.payloadHash !== input.expectedPayloadHash
    )
      throw new ApiError(
        409,
        "approval_stale",
        "The schedule changed after you reviewed it. Review it again."
      )
    const [policy] = await sql<
      { required: boolean }[]
    >`select require_two_person_approval as required from organisation limit 1`
    if ((policy?.required ?? false) !== row.requireTwoPersonApproval)
      throw new ApiError(
        409,
        "approval_policy_changed",
        "The approval policy changed. Ask for the schedule to be submitted again."
      )
    if (row.requireTwoPersonApproval && row.requestedBy === session.userId)
      throw new ApiError(
        409,
        "second_approver_required",
        "A different authorised user must approve this schedule."
      )
    const [requester] =
      await sql`select 1 from member where user_id = ${row.requestedBy}`
    if (!requester)
      throw new ApiError(
        409,
        "approval_actor_access_changed",
        "The person who requested this schedule is no longer a member."
      )
    const occurrences = futureOccurrences(
      scheduleRuleSchema.parse(row.rule),
      row.timezone
    )
    if (!occurrences.length)
      throw new ApiError(
        409,
        "schedule_in_past",
        "Every publication time in this schedule has already passed."
      )
    await sql`
      update post_publication_schedule set status = 'active', status_reason = null, approved_by = ${session.userId}, approved_at = now(),
        approved_revision = revision, updated_at = now() where id = ${scheduleId}`
    await sql`
      insert into post_publication_occurrence (organisation_id, schedule_id, location_id, schedule_revision, intended_at, local_date, local_time, adjustment)
      select ${session.organisationId}, ${scheduleId}, ${locationId}, ${row.revision}, x.intended_at, x.local_date, x.local_time, x.adjustment
      from unnest(${occurrences.map((o) => o.intendedAt)}::timestamptz[], ${occurrences.map((o) => o.localDate)}::date[],
        ${occurrences.map((o) => o.localTime)}::text[], ${occurrences.map((o) => o.adjustment)}::text[]) as x(intended_at, local_date, local_time, adjustment)
      on conflict (schedule_id, schedule_revision, intended_at) do nothing`
    await writeAudit(sql, {
      organisationId: session.organisationId,
      actorUserId: session.userId,
      action: "post_schedule.approved",
      subjectType: "post_schedule",
      subjectId: scheduleId,
      requestId,
      metadata: {
        revision: row.revision,
        payloadHash: row.payloadHash,
        occurrences: occurrences.length,
      },
    })
    return project(sql, session, await loadRow(sql, locationId, scheduleId))
  })
}

/**
 * A material edit (content, rule, zone or offsets) is a new revision. It
 * needs a fresh approval, and every not-yet-run occurrence of the old one is
 * cancelled; nothing already published changes.
 */
export async function revisePublicationSchedule(
  session: Session,
  locationId: string,
  scheduleId: string,
  input: z.infer<typeof scheduleRevisionSchema>,
  requestId: string
) {
  return withTenant(session.organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId, NOT_FOUND)
    if (session.role === "viewer")
      throw new ApiError(403, "forbidden", "Viewers cannot change schedules.")
    const row = await loadRow(sql, locationId, scheduleId, true)
    if (row.status === "cancelled" || row.status === "completed")
      throw new ApiError(
        409,
        "schedule_closed",
        "This schedule has ended. Create a new one."
      )
    const template =
      input.refreshContent && row.sourcePostId
        ? await frozenTemplate(sql, locationId, row.sourcePostId)
        : localPostInputSchema.parse(row.template)
    validateShape(template, input.rule, input.eventOffsets)
    if (!futureOccurrences(input.rule, input.timezone).length)
      throw new ApiError(
        422,
        "schedule_in_past",
        "Every publication time in this schedule has already passed."
      )
    const [policy] = await sql<
      { required: boolean }[]
    >`select require_two_person_approval as required from organisation limit 1`
    const payloadHash = schedulePayloadHash({
      locationId,
      template,
      rule: input.rule,
      timezone: input.timezone,
      eventOffsets: input.eventOffsets,
    })
    if (payloadHash === row.payloadHash && row.status !== "blocked")
      throw new ApiError(
        409,
        "schedule_no_change",
        "Nothing in the schedule changed."
      )
    await sql`
      update post_publication_occurrence set status = 'cancelled', status_reason = 'approval_invalidated', finished_at = now()
      where schedule_id = ${scheduleId} and status = 'scheduled'`
    await sql`
      update post_publication_schedule set template = ${jsonColumn(sql, template)}, rule = ${jsonColumn(sql, input.rule)}, timezone = ${input.timezone},
        event_offsets = ${jsonColumnOrNull(sql, input.eventOffsets)}, payload_hash = ${payloadHash}, revision = revision + 1,
        status = 'awaiting_approval', status_reason = null, approved_by = null, approved_at = null, approved_revision = null,
        requested_by = ${session.userId}, require_two_person_approval = ${policy?.required ?? false}, updated_at = now()
      where id = ${scheduleId}`
    await writeAudit(sql, {
      organisationId: session.organisationId,
      actorUserId: session.userId,
      action: "post_schedule.revised",
      subjectType: "post_schedule",
      subjectId: scheduleId,
      requestId,
      metadata: { previousRevision: row.revision, payloadHash },
    })
    return project(sql, session, await loadRow(sql, locationId, scheduleId))
  })
}

export async function actOnPublicationSchedule(
  session: Session,
  locationId: string,
  scheduleId: string,
  action: "pause" | "resume" | "cancel",
  requestId: string
) {
  return withTenant(session.organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId, NOT_FOUND)
    if (!isManagerialRole(session.role))
      throw new ApiError(
        403,
        "forbidden",
        "Only an owner or administrator can pause, resume or cancel a schedule."
      )
    const row = await loadRow(sql, locationId, scheduleId, true)
    if (action === "pause") {
      if (row.status !== "active")
        throw new ApiError(
          409,
          "schedule_not_active",
          "Only an active schedule can be paused."
        )
      await sql`update post_publication_schedule set status = 'paused', updated_at = now() where id = ${scheduleId}`
    } else if (action === "resume") {
      if (row.status !== "paused")
        throw new ApiError(
          409,
          "schedule_not_paused",
          "Only a paused schedule can be resumed."
        )
      const [policy] = await sql<
        { required: boolean }[]
      >`select require_two_person_approval as required from organisation limit 1`
      if ((policy?.required ?? false) !== row.requireTwoPersonApproval)
        throw new ApiError(
          409,
          "approval_policy_changed",
          "The approval policy changed. Edit the schedule and approve it again."
        )
      if (row.approvedBy) await requireCurrentManager(sql, row.approvedBy)
      await sql`update post_publication_schedule set status = 'active', updated_at = now() where id = ${scheduleId}`
    } else {
      if (row.status === "cancelled" || row.status === "completed")
        throw new ApiError(
          409,
          "schedule_closed",
          "This schedule has already ended."
        )
      await sql`update post_publication_occurrence set status = 'cancelled', status_reason = 'schedule_cancelled', finished_at = now() where schedule_id = ${scheduleId} and status = 'scheduled'`
      await sql`update post_publication_schedule set status = 'cancelled', updated_at = now() where id = ${scheduleId}`
    }
    await writeAudit(sql, {
      organisationId: session.organisationId,
      actorUserId: session.userId,
      action: `post_schedule.${action === "cancel" ? "cancelled" : action === "pause" ? "paused" : "resumed"}`,
      subjectType: "post_schedule",
      subjectId: scheduleId,
      requestId,
      metadata: { revision: row.revision },
    })
    return project(sql, session, await loadRow(sql, locationId, scheduleId))
  })
}

/** Calendar and agenda: occurrences in a window, limited to locations the viewer can see. */
export async function listScheduleOccurrences(
  session: Session,
  query: z.infer<typeof occurrencesQuerySchema>
) {
  return withTenant(session.organisationId, async (sql) => {
    const rows = await sql`
      select o.id::text as id, o.schedule_id::text as "scheduleId", o.location_id::text as "locationId", l.name as "locationName",
        o.intended_at as "intendedAt", o.local_date::text as "localDate", o.local_time as "localTime", s.timezone, o.adjustment,
        o.status, o.status_reason as "statusReason", o.post_id::text as "postId",
        coalesce(s.template ->> 'summary', '') as summary, coalesce(s.template ->> 'topicType', '') as "topicType"
      from post_publication_occurrence o
      join post_publication_schedule s on s.id = o.schedule_id
      join location l on l.id = o.location_id
      where o.intended_at >= ${query.from}::timestamptz and o.intended_at < ${query.to}::timestamptz
        and ${visibilityPredicate(sql, session, sql`o.location_id`)}
        ${query.locationId ? sql`and o.location_id = ${query.locationId}` : sql``}
        ${query.clientId ? sql`and l.client_id = ${query.clientId}` : sql``}
      order by o.intended_at, o.id
      limit 2000`
    return occurrencesResponseSchema.parse({
      occurrences: rows.map((row) => ({
        ...row,
        intendedAt: (row.intendedAt as Date).toISOString(),
      })),
    })
  })
}
