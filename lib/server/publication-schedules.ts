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
  DISPATCH_WINDOW_MS,
  eventOffsetsSchema,
  expandSchedule,
  formatUtcOffset,
  planOnceSlot,
  resolveLocalSlot,
  SCHEDULE_MIN_LEAD_MS,
  scheduleRuleSchema,
  slotProblemMessage,
  type PlannedOccurrence,
  type ScheduleRule,
} from "@/lib/domain/publication-schedule"
import { writeAudit } from "@/lib/server/audit"
import { jsonColumn, jsonColumnOrNull, withTenant } from "@/lib/server/db"
import { stableGoogleHash } from "@/lib/server/gbp-management"
import { ApiError } from "@/lib/server/http"
import { isOrgFeatureEnabled } from "@/lib/server/org-features"
import {
  canPublishLocation,
  isManagerialRole,
  requireLocationAccess,
  requireLocationAction,
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
  offsetMinutes: number | null
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

export const SCHEDULING_UNAVAILABLE = {
  code: "post_scheduling_unavailable",
  message: "Scheduled publishing is not switched on for this workspace.",
}
export const RECURRING_UNAVAILABLE = {
  code: "schedule_recurring_unavailable",
  message:
    "Repeating schedules are not available. Schedule a single publication instead.",
}

/**
 * Whether the organisation may schedule, and schedule this rule. One-time
 * publication needs `post_scheduling`; a repeating rule also needs
 * `post_scheduling_recurring`. Runs in the caller's tenant transaction
 * (organisation_feature forces RLS); the runner uses the same answer.
 */
export async function schedulingAvailability(
  sql: TransactionSql,
  organisationId: string,
  rule?: ScheduleRule
): Promise<"ok" | "feature_disabled" | "recurring_disabled"> {
  if (!(await isOrgFeatureEnabled(sql, organisationId, "post_scheduling")))
    return "feature_disabled"
  if (
    rule &&
    rule.frequency !== "once" &&
    !(await isOrgFeatureEnabled(
      sql,
      organisationId,
      "post_scheduling_recurring"
    ))
  )
    return "recurring_disabled"
  return "ok"
}

/**
 * The route-side gate for every action that can lead to a publication:
 * create, approve, revise, resume and the calendar. Listing, pausing and
 * cancelling stay available with the feature off, so existing schedules can
 * always be seen and stopped.
 */
async function requireScheduling(
  sql: TransactionSql,
  organisationId: string,
  rule?: ScheduleRule
) {
  const availability = await schedulingAvailability(sql, organisationId, rule)
  if (availability === "feature_disabled")
    throw new ApiError(
      404,
      SCHEDULING_UNAVAILABLE.code,
      SCHEDULING_UNAVAILABLE.message
    )
  if (availability === "recurring_disabled")
    throw new ApiError(
      422,
      RECURRING_UNAVAILABLE.code,
      RECURRING_UNAVAILABLE.message
    )
}

/**
 * The content, rule, zone, slot offset, event offsets and target that one
 * approval covers. The slot offset is hashed only for a one-time time that
 * happens twice, the one case where it adds anything: elsewhere the rule and
 * zone already fix the instant. So a repeating schedule's hash, and the hash
 * of a one-time schedule stored before 0241 (which 0241 or its approval gives
 * an offset), is the hash the server computes for the same content now.
 */
export function schedulePayloadHash(input: {
  locationId: string
  template: unknown
  rule: ScheduleRule
  timezone: string
  eventOffsets: unknown
  offsetMinutes?: number | null
}) {
  return stableGoogleHash({
    locationId: input.locationId,
    template: input.template,
    rule: input.rule,
    timezone: input.timezone,
    eventOffsets: input.eventOffsets ?? null,
    ...(input.offsetMinutes != null &&
    input.rule.frequency === "once" &&
    resolveLocalSlot(input.rule.startDate, input.rule.localTime, input.timezone)
      .kind === "ambiguous"
      ? { offsetMinutes: input.offsetMinutes }
      : {}),
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
      s.revision, s.payload_hash as "payloadHash", s.rule, s.timezone, s.offset_minutes as "offsetMinutes", s.event_offsets as "eventOffsets", s.template,
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
  // A one-time slot is shown as the strict plan would run it; a waiting one
  // is also checked against the bookable window, since approval needs that.
  // A live one-time row always has its offset or is waiting or in review
  // (0241); an ended one from before 0241 without one is shown as the
  // lenient rules ran it, since that is what happened.
  const ended = row.status === "cancelled" || row.status === "completed"
  const once =
    rule.frequency === "once" && !(ended && row.offsetMinutes === null)
      ? planOnceSlot(
          rule,
          row.timezone,
          row.offsetMinutes,
          row.status === "awaiting_approval" ? new Date() : null
        )
      : null
  const expansion =
    once === null
      ? expandSchedule(rule, row.timezone)
      : {
          occurrences: once.ok ? [once.occurrence] : [],
          skippedDates: [],
          truncated: false,
        }
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
      problem: once && !once.ok ? once.problem : null,
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

type SlotPlan = {
  occurrences: PlannedOccurrence[]
  /** Set for a one-time slot; null for a repeating rule. */
  offsetMinutes: number | null
}

/**
 * The occurrences a rule would materialise now, under the rules its
 * frequency gets (P08-R2). One-time: the strict slot, 5 minutes to 90 days
 * ahead, no nonexistent time, an explicit offset for a repeated one. A
 * repeating rule keeps its lenient clock-change rules, and only occurrences
 * at least 5 minutes ahead count. Throws `status` (422 on input, 409 at
 * approval, where time has passed or the stored slot no longer resolves).
 */
function planSlots(
  rule: ScheduleRule,
  timezone: string,
  offsetMinutes: number | null,
  status: 409 | 422,
  now = new Date()
): SlotPlan {
  if (rule.frequency === "once") {
    const plan = planOnceSlot(rule, timezone, offsetMinutes, now)
    if (!plan.ok)
      throw new ApiError(
        status,
        plan.problem,
        slotProblemMessage(plan.problem),
        {
          details:
            plan.choices.length > 0
              ? {
                  choices: plan.choices.map((choice) => ({
                    offsetMinutes: choice.offsetMinutes,
                    utcOffset: formatUtcOffset(choice.offsetMinutes),
                    intendedAt: choice.instant.toISOString(),
                  })),
                }
              : undefined,
        }
      )
    return { occurrences: [plan.occurrence], offsetMinutes: plan.offsetMinutes }
  }
  if (offsetMinutes !== null)
    throw new ApiError(
      status,
      "schedule_offset_not_applicable",
      "Only a single publication takes a UTC offset."
    )
  const occurrences = expandSchedule(rule, timezone).occurrences.filter(
    (occurrence) =>
      Date.parse(occurrence.intendedAt) >= now.getTime() + SCHEDULE_MIN_LEAD_MS
  )
  if (!occurrences.length)
    throw new ApiError(
      status,
      "schedule_in_past",
      "Every publication time in this schedule has already passed."
    )
  return { occurrences, offsetMinutes: null }
}

export async function createPublicationSchedule(
  session: Session,
  locationId: string,
  draft: ScheduleDraft,
  requestId: string
) {
  return withTenant(session.organisationId, async (sql) => {
    await requireScheduling(sql, session.organisationId, draft.rule)
    // A schedule is a request for approval of the posts it will publish.
    await requireLocationAction(
      sql,
      session,
      locationId,
      "request_approval",
      NOT_FOUND
    )
    const [location] = await sql<
      { timezone: string | null }[]
    >`select timezone from location where id = ${locationId}`
    const timezone =
      draft.timezone ?? location?.timezone ?? DEFAULT_SCHEDULE_TIMEZONE
    const template = await frozenTemplate(sql, locationId, draft.postId)
    validateShape(template, draft.rule, draft.eventOffsets)
    const { offsetMinutes } = planSlots(
      draft.rule,
      timezone,
      draft.offsetMinutes,
      422
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
      offsetMinutes,
    })
    const [created] = await sql<{ id: string }[]>`
      insert into post_publication_schedule (organisation_id, location_id, source_post_id, template, event_offsets, rule, timezone, offset_minutes, payload_hash, requested_by, require_two_person_approval)
      values (${session.organisationId}, ${locationId}, ${draft.postId}, ${jsonColumn(sql, template)}, ${jsonColumnOrNull(sql, draft.eventOffsets)},
        ${jsonColumn(sql, draft.rule)}, ${timezone}, ${offsetMinutes}, ${payloadHash}, ${session.userId}, ${policy?.required ?? false})
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
    await requireScheduling(
      sql,
      session.organisationId,
      scheduleRuleSchema.parse(row.rule)
    )
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
    // The slot is checked again now: the window has moved since the request,
    // and a one-time slot must still resolve to the offset its hash covers
    // (a row from before 0241 has none stored and must be unambiguous). The
    // resolved offset is stored: for such a row the time happens once, so it
    // is not a guess and its hash, which leaves that offset out, still holds.
    const { occurrences, offsetMinutes } = planSlots(
      scheduleRuleSchema.parse(row.rule),
      row.timezone,
      row.offsetMinutes,
      409
    )
    await sql`
      update post_publication_schedule set status = 'active', status_reason = null, approved_by = ${session.userId}, approved_at = now(),
        approved_revision = revision, offset_minutes = ${offsetMinutes}, updated_at = now() where id = ${scheduleId}`
    await sql`
      insert into post_publication_occurrence (organisation_id, schedule_id, location_id, schedule_revision, intended_at, deadline_at, local_date, local_time, adjustment)
      select ${session.organisationId}, ${scheduleId}, ${locationId}, ${row.revision}, x.intended_at, x.intended_at + ${`${DISPATCH_WINDOW_MS / 1000} seconds`}::interval,
        x.local_date, x.local_time, x.adjustment
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
    await requireScheduling(sql, session.organisationId, input.rule)
    // A new revision asks for approval again.
    await requireLocationAction(
      sql,
      session,
      locationId,
      "request_approval",
      NOT_FOUND
    )
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
    const { offsetMinutes } = planSlots(
      input.rule,
      input.timezone,
      input.offsetMinutes,
      422
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
      offsetMinutes,
    })
    // A blocked or quarantined schedule may be submitted again unchanged.
    if (
      payloadHash === row.payloadHash &&
      row.status !== "blocked" &&
      row.status !== "needs_review"
    )
      throw new ApiError(
        409,
        "schedule_no_change",
        "Nothing in the schedule changed."
      )
    await sql`
      update post_publication_occurrence set status = 'cancelled', status_reason = 'approval_invalidated', finished_at = now()
      where schedule_id = ${scheduleId} and status = 'scheduled'`
    await sql`
      update post_publication_schedule set template = ${jsonColumn(sql, template)}, rule = ${jsonColumn(sql, input.rule)}, timezone = ${input.timezone}, offset_minutes = ${offsetMinutes},
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
      await requireScheduling(
        sql,
        session.organisationId,
        scheduleRuleSchema.parse(row.rule)
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
    await requireScheduling(sql, session.organisationId)
    const rows = await sql`
      select o.id::text as id, o.schedule_id::text as "scheduleId", o.location_id::text as "locationId", l.name as "locationName",
        o.intended_at as "intendedAt", o.deadline_at as "deadlineAt", o.local_date::text as "localDate", o.local_time as "localTime", s.timezone, o.adjustment,
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
        deadlineAt: (row.deadlineAt as Date).toISOString(),
      })),
    })
  })
}
