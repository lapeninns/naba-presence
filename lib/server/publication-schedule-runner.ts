import "server-only"

import type { TransactionSql } from "postgres"

import type { OperationalEvent } from "@/lib/contracts/operational-events"
import { localPostInputSchema } from "@/lib/contracts/location-posts"
import {
  contentExpired,
  eventOffsetsSchema,
  occurrenceEventDates,
  scheduledPublishIntentId,
  scheduleRuleSchema,
  selectDueOccurrences,
} from "@/lib/domain/publication-schedule"
import { writeAudit } from "@/lib/server/audit"
import {
  approvalSession,
  recheckApprovedWork,
} from "@/lib/server/authz/approval-policy"
import { sha256 } from "@/lib/server/crypto"
import {
  getDatabase,
  jsonColumn,
  jsonColumnOrNull,
  withTenant,
} from "@/lib/server/db"
import { organisationWriteBlock } from "@/lib/server/entitlement-policy"
import { getServerEnv } from "@/lib/server/env"
import { ApiError, parseStored } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import { recordOperationalEvent } from "@/lib/server/notifications/operational"
import {
  gbpWriteScopes,
  loadPauseSnapshot,
  scopesEnabled,
} from "@/lib/server/pause-controls"
import {
  publishScheduledLocalPost,
  SCHEDULE_DEADLINE_PASSED,
  SCHEDULE_SOURCE_CHANGED,
  SCHEDULE_TARGET_CHANGED,
} from "@/lib/server/posts"
import {
  invalidateSourceSchedules,
  lockSourceSchedules,
  sourceState,
  schedulingAvailability,
} from "@/lib/server/publication-schedules"
import type { Session } from "@/lib/server/session"

type Schedule = {
  id: string
  organisationId: string
  locationId: string
  status: string
  revision: number
  rule: unknown
  timezone: string
  template: Record<string, unknown>
  eventOffsets: unknown
  /** The draft a one-time schedule publishes, at its frozen revision (P08-R4). */
  sourcePostId: string | null
  sourceContentRevision: number | null
  sourceContentHash: string | null
  requestedBy: string
  approvedBy: string | null
  approvedRevision: number | null
  requireTwoPersonApproval: boolean
  /** Frozen at approval (0118): what the approval was given for. */
  targetConnectionId: string | null
  targetGeneration: number | null
  targetLocationName: string | null
  approvedApprovalRequired: boolean | null
  /**
   * The approver's assurance when they approved (0106): the security version
   * is rechecked before every publish (recheckAuthorisation), and the aal and
   * proof time go on the publish's attempt. Null on approvals recorded
   * before 0106, which are judged on the other checks alone.
   */
  approvedSecurityVersion: number | null
  approvedAal: "aal1" | "aal2" | null
  approvedMfaVerifiedAt: Date | null
}
type Due = {
  id: string
  intendedAt: string
  deadlineAt: string
  localDate: string
  postId: string | null
}
type MissedReason = "outside_dispatch_window" | "paused_when_due"
type BlockReason =
  "approval_invalid" | "permission_revoked" | "connection_changed"
export type ScheduleTickSummary = {
  schedules: number
  published: number
  rejected: number
  ambiguous: number
  missed: number
  blocked: number
  /** One-time occurrences whose source draft was published another way or deleted. */
  superseded: number
  /**
   * Schedules re-frozen for a fresh approval because their source draft
   * changed without the editor (P08-R4); not blocked.
   */
  sourceChanged: number
  /**
   * Due one-time occurrences left scheduled because their draft was being
   * published by hand (P08-R4); looked at again on a later tick.
   */
  sourceInFlight: number
  /**
   * Due occurrences held because the organisation is read-only under billing
   * enforcement (P07-S3): nothing is sent, and the slot is recorded missed
   * once its window closes.
   */
  readOnly: number
}
export type ScheduleSweepSummary = {
  missed: number
  resolved: number
  /** Schedules sent to review because an earlier publication proves nothing. */
  unverified: number
}

function googleDate(date: string) {
  const [year, month, day] = date.split("-").map(Number)
  return { year, month, day }
}

/**
 * The post body for one occurrence: the frozen template. Only a repeating
 * schedule moves event dates by its frozen offsets; a one-time schedule
 * publishes exactly the content that was approved.
 */
function occurrenceContent(schedule: Schedule, occurrence: Due) {
  const template = parseStored(
    localPostInputSchema,
    schedule.template,
    "post_schedule.template"
  )
  const once =
    parseStored(scheduleRuleSchema, schedule.rule, "post_schedule.rule")
      .frequency === "once"
  const offsets =
    !once && schedule.eventOffsets
      ? parseStored(
          eventOffsetsSchema,
          schedule.eventOffsets,
          "post_schedule.event_offsets"
        )
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
const eventBase = (organisationId: string, locationId: string) => ({
  version: 1 as const,
  organisationId,
  occurredAt: new Date().toISOString(),
  target: { type: "location" as const, locationId },
})
const base = (schedule: Schedule) =>
  eventBase(schedule.organisationId, schedule.locationId)

/**
 * Records a due occurrence as missed. A one-time schedule whose slot passed
 * needs a new time, so it goes to review (as mark_missed_post_occurrences()
 * does in 0118); a repeating one carries on with its next occurrence.
 */
async function markMissed(
  sql: TransactionSql,
  schedule: Schedule,
  occurrence: Pick<Due, "id" | "intendedAt">,
  reason: MissedReason | "expired_content",
  summary?: ScheduleTickSummary
) {
  const [marked] = await sql`
    update post_publication_occurrence set status = 'missed', status_reason = ${reason}, finished_at = now()
    where id = ${occurrence.id} and status in ('scheduled', 'publishing') returning id`
  if (!marked) return
  if (
    reason !== "expired_content" &&
    parseStored(scheduleRuleSchema, schedule.rule, "post_schedule.rule")
      .frequency === "once"
  )
    await sql`update post_publication_schedule set status = 'needs_review', status_reason = ${reason}, updated_at = now()
      where id = ${schedule.id} and status in ('active', 'paused')`
  await emit(sql, {
    ...base(schedule),
    kind: "schedule_missed",
    reason,
    dueAt: occurrence.intendedAt,
    source: {
      type: "schedule_occurrence",
      id: occurrence.id,
      scheduleId: schedule.id,
    },
  })
  if (summary) summary.missed += 1
}

/**
 * A one-time occurrence whose source draft reached an end state another way
 * (P08-R4): it is on Google or was deleted. A publish still in flight is not
 * this (sourceState). Nothing is sent; the occurrence and its schedule end as
 * superseded rather than publishing the content a second time.
 */
async function supersede(
  sql: TransactionSql,
  schedule: Schedule,
  occurrence: Pick<Due, "id">,
  requestId: string,
  summary?: ScheduleTickSummary
) {
  await sql`
    update post_publication_occurrence set status = 'cancelled', status_reason = 'source_superseded', finished_at = now()
    where schedule_id = ${schedule.id} and status = 'scheduled'`
  const [ended] = await sql`
    update post_publication_schedule set status = 'cancelled', status_reason = 'source_superseded', updated_at = now()
    where id = ${schedule.id} and status = 'active' returning id`
  // Its approvers hear that the approved publication will not happen.
  if (ended)
    await emit(sql, {
      ...base(schedule),
      kind: "schedule_blocked",
      reason: "source_superseded",
      source: {
        type: "schedule_occurrence",
        id: occurrence.id,
        scheduleId: schedule.id,
      },
    })
  await writeAudit(sql, {
    organisationId: schedule.organisationId,
    actorUserId: null,
    action: "post_schedule.superseded",
    subjectType: "post_schedule",
    subjectId: schedule.id,
    requestId,
    metadata: { occurrenceId: occurrence.id, postId: schedule.sourcePostId },
  })
  if (summary) summary.superseded += 1
}

/**
 * Checks that need a fresh approval when they fail. Null when the schedule
 * may run. Both people's authority is re-decided now through the shared
 * approval policy (recheckApprovedWork) against what the approval froze: the
 * connection and credential generation (a relink or reconnect since blocks),
 * the approval policy, and the approver's security version.
 */
async function approvalProblem(
  sql: TransactionSql,
  schedule: Schedule,
  link: { googleLocationName: string | null }
): Promise<BlockReason | null> {
  if (
    !schedule.approvedBy ||
    schedule.approvedRevision !== schedule.revision ||
    schedule.approvedApprovalRequired === null
  )
    return "approval_invalid"
  // An approval from before 0118 that no link could pin, or one whose
  // Google location has since changed, was not given for this target.
  if (
    !schedule.targetConnectionId ||
    schedule.targetGeneration === null ||
    !schedule.targetLocationName ||
    link.googleLocationName !== schedule.targetLocationName
  )
    return "connection_changed"
  // Both people are re-decided through the shared approval policy
  // (lib/server/authz/approval-policy.ts), as for bulk batches: the
  // requester may still ask for approval of posts here, the approver may
  // still publish here as an owner or admin through the frozen connection
  // and credential generation, the frozen policy (both flags) still holds,
  // and under two-person approval they are two different people. The
  // approver's security version at approval (0106) must still be theirs:
  // operator MFA recovery bumps it (security_version_changed, reported as
  // approval_invalid); approvals recorded before 0106 (null) are not
  // compared. The entitlement (stream B) is checked by
  // scheduledPostEntitlement() before this runs; it is not passed to the
  // recheck, whose `entitlement` input still refuses any value it is given.
  const recheck = await recheckApprovedWork(sql, {
    organisationId: schedule.organisationId,
    locationId: schedule.locationId,
    requestedBy: schedule.requestedBy,
    approvedBy: schedule.approvedBy,
    requireTwoPersonApproval: schedule.requireTwoPersonApproval,
    policy: {
      approvalRequired: schedule.approvedApprovalRequired,
      requireTwoPersonApproval: schedule.requireTwoPersonApproval,
    },
    connectionId: schedule.targetConnectionId,
    generation: schedule.targetGeneration,
    approverSecurityVersion: schedule.approvedSecurityVersion,
  })
  if (!recheck.ok) {
    switch (recheck.reason) {
      case "connection_changed":
      case "generation_changed":
        return "connection_changed"
      case "actor_not_member":
      case "location_hidden":
      case "action_denied":
      case "approver_not_manager":
        return "permission_revoked"
      default:
        return "approval_invalid"
    }
  }
  return null
}

/**
 * The entitlement check for scheduled publication (P07-S3, stream B). A
 * read-only organisation (deriveAccess, lib/domain/entitlements.ts, through
 * organisationWriteBlock) starts no new publication: the schedule is held
 * before anything is claimed or sent. Billing enforcement's rollout flags
 * apply (BILLING_ENFORCEMENT_ENABLED and the organisation's own
 * enforcement_enabled): where enforcement does not apply, this is "ok".
 * Fails closed: an organisation whose billing cannot be read throws, and the
 * tick sends nothing for it.
 */
async function scheduledPostEntitlement(
  sql: TransactionSql,
  organisationId: string,
  now: Date
): Promise<"ok" | "read_only"> {
  return (await organisationWriteBlock(sql, organisationId, now)) === null
    ? "ok"
    : "read_only"
}

/**
 * The approver's session for the publish (approvalSession). The recheck
 * that ran earlier in this transaction proved the approver is a member, so
 * a missing one throws and the claim rolls back.
 */
async function approverSession(
  sql: TransactionSql,
  schedule: Schedule
): Promise<Session> {
  // The publish goes out under the approval, so its attempt records the
  // assurance the approval was given with (0106), not a worker's.
  const session = await approvalSession(sql, {
    organisationId: schedule.organisationId,
    approvedBy: schedule.approvedBy!,
    sessionId: `post-schedule:${schedule.id}`,
    approvedAal: schedule.approvedAal,
    approvedMfaVerifiedAt: schedule.approvedMfaVerifiedAt,
    approvedSecurityVersion: schedule.approvedSecurityVersion,
  })
  if (!session) throw new Error("Schedule approver is no longer a member")
  return session
}

/** One claimed schedule: at most one publication per tick, never a resend of an unresolved one. */
export async function processSchedule(
  organisationId: string,
  scheduleId: string,
  requestId: string,
  now = new Date(),
  summary?: ScheduleTickSummary
) {
  // Read before the transaction: a pooled read inside it could wait on the
  // connection the transaction itself holds (lib/server/db.ts).
  const pauses = await loadPauseSnapshot()
  const plan = await withTenant(organisationId, async (sql) => {
    // Every live schedule made from the same draft is locked first, in id
    // order, then this one and the draft: the order the editor takes them
    // in. Re-freezing (invalidateSourceSchedules) touches those siblings, so
    // locking only this one first could wait on the editor in reverse.
    const [owner] = await sql<{ sourcePostId: string | null }[]>`
      select source_post_id::text as "sourcePostId" from post_publication_schedule where id = ${scheduleId}`
    if (owner?.sourcePostId) await lockSourceSchedules(sql, owner.sourcePostId)
    const [schedule] = await sql<Schedule[]>`
      select id::text as id, organisation_id::text as "organisationId", location_id::text as "locationId", status, revision, rule, timezone, template,
        event_offsets as "eventOffsets", source_post_id::text as "sourcePostId",
        source_content_revision::integer as "sourceContentRevision", source_content_hash as "sourceContentHash",
        requested_by::text as "requestedBy", approved_by::text as "approvedBy",
        approved_revision as "approvedRevision", require_two_person_approval as "requireTwoPersonApproval",
        target_google_connection_id::text as "targetConnectionId", target_credential_generation as "targetGeneration",
        target_google_location_name as "targetLocationName", approved_approval_required as "approvedApprovalRequired",
        approved_security_version as "approvedSecurityVersion", approved_aal as "approvedAal",
        approved_mfa_verified_at as "approvedMfaVerifiedAt"
      from post_publication_schedule where id = ${scheduleId} for update`
    if (!schedule || schedule.status !== "active") return null
    const due = await sql<Due[]>`
      select id::text as id, to_char(intended_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "intendedAt",
        to_char(deadline_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "deadlineAt",
        local_date::text as "localDate", post_id::text as "postId"
      from post_publication_occurrence
      where schedule_id = ${scheduleId} and schedule_revision = ${schedule.revision} and status = 'scheduled' and intended_at <= ${now}
      order by intended_at`
    // Outside its window an occurrence never starts (P08-R3). The tick's
    // sweep (mark_missed_post_occurrences) normally records these first;
    // this covers one whose window closed since.
    const { run, missed } = selectDueOccurrences(due, now)
    for (const occurrence of missed)
      await markMissed(
        sql,
        schedule,
        occurrence,
        "outside_dispatch_window",
        summary
      )
    if (!run) return { schedule, run: null }
    const blocked = async (
      reason: BlockReason | "feature_disabled" | "recurring_disabled"
    ) => {
      await sql`update post_publication_schedule set status = 'blocked', status_reason = ${reason}, updated_at = now() where id = ${scheduleId}`
      await emit(sql, {
        ...base(schedule),
        kind: "schedule_blocked",
        reason,
        source: { type: "schedule_occurrence", id: run.id, scheduleId },
      })
      if (summary) summary.blocked += 1
      return null
    }
    // The organisation feature is read in this tenant transaction
    // (organisation_feature forces RLS). Switched off, a due schedule is
    // blocked rather than left to publish later: switching the feature back
    // on does not revive an approval given before it went off.
    const availability = await schedulingAvailability(
      sql,
      organisationId,
      parseStored(scheduleRuleSchema, schedule.rule, "post_schedule.rule")
    )
    if (availability !== "ok") return blocked(availability)
    const env = getServerEnv()
    const [link] = await sql<{ googleLocationName: string | null }[]>`
      select e.google_location_name as "googleLocationName"
      from location_link ll join external_location e on e.id = ll.external_location_id
      join google_connection gc on gc.id = e.google_connection_id
      where ll.location_id = ${schedule.locationId} and ll.is_active and gc.status in ('active', 'expired')`
    // Env and the operator pause table alike (lib/server/pause-controls.ts):
    // a table pause is the same transient block, not a failed occurrence.
    const paused = !scopesEnabled(env, pauses, gbpWriteScopes("posts"))
    // So is a read-only subscription under billing enforcement
    // (lib/server/entitlement-policy.ts): nothing new is sent while it lasts.
    const readOnly =
      (await scheduledPostEntitlement(sql, organisationId, now)) === "read_only"
    if (paused || readOnly || !link) {
      // Transient: the approval stands. The occurrence waits inside its
      // window and is recorded missed once the window closes; a schedule
      // that is still read-only then has missed it, and nothing publishes
      // late when the subscription recovers.
      await emit(sql, {
        ...base(schedule),
        kind: "schedule_blocked",
        reason: paused
          ? "publishing_paused"
          : readOnly
            ? "billing_read_only"
            : "connection_unavailable",
        source: { type: "schedule_occurrence", id: run.id, scheduleId },
      })
      if (readOnly && summary) summary.readOnly += 1
      if (readOnly)
        log.info("post_schedule.read_only", {
          organisationId,
          scheduleId,
          occurrenceId: run.id,
        })
      return { schedule, run: null }
    }
    const problem = await approvalProblem(sql, schedule, link)
    if (problem) return blocked(problem)
    const { content, eventEndDate } = occurrenceContent(schedule, run)
    if (contentExpired(eventEndDate, now, schedule.timezone)) {
      await markMissed(sql, schedule, run, "expired_content", summary)
      return { schedule, run: null }
    }
    // A one-time occurrence publishes its source draft (P08-R4), at the
    // revision the approval covered, rather than a copy that would leave the
    // draft behind. The draft is locked after its schedules (the order an
    // edit takes them in), so an edit waits for this claim or lands first.
    let postId = run.postId
    let source: { revision: number; hash: string | null } | null = null
    if (
      parseStored(scheduleRuleSchema, schedule.rule, "post_schedule.rule")
        .frequency === "once"
    ) {
      const [post] = schedule.sourcePostId
        ? await sql<
            {
              revision: number
              status: string
              googlePostName: string | null
            }[]
          >`
            select content_revision::integer as revision, status, google_post_name as "googlePostName"
            from gbp_local_post where id = ${schedule.sourcePostId} and location_id = ${schedule.locationId}
            for update`
        : []
      const state = post ? sourceState(post) : "superseded"
      if (state === "superseded") {
        await supersede(sql, schedule, run, requestId, summary)
        return { schedule, run: null }
      }
      if (state === "in_flight") {
        // Someone is publishing the draft by hand. If that publish fails the
        // draft is publishable again, so the occurrence stays scheduled: a
        // later tick inside its window publishes it or finds it superseded,
        // and past the window it is missed.
        log.info("post_schedule.source_in_flight", {
          organisationId,
          scheduleId,
          occurrenceId: run.id,
        })
        if (summary) summary.sourceInFlight += 1
        return { schedule, run: null }
      }
      if (post.revision !== schedule.sourceContentRevision) {
        // Changed some way other than the editor (which re-freezes in its
        // own transaction), or bound before 0120: re-freeze it for a fresh
        // approval and send nothing.
        await invalidateSourceSchedules(sql, {
          organisationId,
          locationId: schedule.locationId,
          postId: schedule.sourcePostId!,
          actorUserId: null,
          requestId,
        })
        if (summary) summary.sourceChanged += 1
        return { schedule, run: null }
      }
      postId = schedule.sourcePostId
      source = {
        revision: post.revision,
        hash: schedule.sourceContentHash,
      }
    }
    // Claim the occurrence and, for a repeating schedule, create its own
    // post in one transaction, so a retried tick finds the same post (and
    // the same publish idempotency key). A post left by an earlier claim
    // that sent nothing is reused.
    if (!postId) {
      const [external] = await sql<
        { id: string }[]
      >`select external_location_id::text as id from location_link where location_id = ${schedule.locationId} and is_active limit 1`
      const [post] = await sql<{ id: string }[]>`
        insert into gbp_local_post (organisation_id, location_id, external_location_id, topic_type, language_code, summary, call_to_action, event, offer, media, created_by)
        values (${organisationId}, ${schedule.locationId}, ${external.id}, ${content.topicType}, ${content.languageCode}, ${content.summary},
          ${jsonColumnOrNull(sql, content.callToAction)}, ${jsonColumnOrNull(sql, content.event)}, ${jsonColumnOrNull(sql, content.offer)}, ${jsonColumn(sql, content.media)}, ${schedule.requestedBy})
        returning id::text as id`
      postId = post.id
    }
    const intentId = scheduledPublishIntentId(run.id, sha256)
    const [claimed] =
      await sql`update post_publication_occurrence set status = 'publishing', started_at = now(), post_id = ${postId}, intent_id = ${intentId}
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
        postId,
        intendedAt: run.intendedAt,
        intentId,
      },
    })
    return {
      schedule,
      run: { ...run, postId, intentId, source },
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
      intentId: run.intentId,
      deadline: new Date(run.deadlineAt),
      target: {
        googleConnectionId: schedule.targetConnectionId!,
        googleLocationName: schedule.targetLocationName!,
      },
      approvalRef: `post_schedule:${schedule.id}:${schedule.revision}`,
      securityVersion: schedule.approvedSecurityVersion,
      source: run.source,
    })
  } catch (error) {
    failure = error
  }
  const failureCode = failure instanceof ApiError ? failure.code : null
  await withTenant(organisationId, async (sql) => {
    // The occurrence settles from the publish's receipt (mutation_operation,
    // recorded under the occurrence's intent before anything was sent).
    // Only this publish's own receipt counts: the local_post write for this
    // occurrence's post. Another write that took the intent first (its key
    // is derived from the occurrence id) made this publish an
    // intent_conflict with nothing sent, so it is no receipt of ours.
    const [receipt] = await sql<
      { state: string; errorCode: string | null; attemptId: string | null }[]
    >`
      select state, error_code as "errorCode", attempt_id::text as "attemptId"
      from mutation_operation
      where organisation_id = ${organisationId} and intent_id = ${run.intentId}
        and surface = 'local_post' and target_ref = ${run.postId}`
    if (!receipt) {
      // No receipt of its own: the publish stopped before it was recorded,
      // so nothing reached Google.
      // The source draft moved on after the claim: refused before the
      // provider call (or by the publish claim, approval_post_changed). The
      // edit re-froze the schedule for a fresh approval; this occurrence
      // belonged to the old approval, so it ends here.
      if (
        run.source &&
        (failureCode === SCHEDULE_SOURCE_CHANGED ||
          failureCode === "approval_post_changed")
      ) {
        // The draft's schedules first (the editor's order), then the
        // occurrence.
        await lockSourceSchedules(sql, run.postId)
        await sql`update post_publication_occurrence set status = 'cancelled', status_reason = 'source_changed', finished_at = now()
          where id = ${run.id} and status = 'publishing'`
        await invalidateSourceSchedules(sql, {
          organisationId,
          locationId: schedule.locationId,
          postId: run.postId,
          actorUserId: null,
          requestId,
        })
        if (summary) summary.sourceChanged += 1
        log.warn("post_schedule.source_changed", {
          organisationId,
          scheduleId,
          occurrenceId: run.id,
        })
        return
      }
      // Otherwise the occurrence waits for the next tick inside its window;
      // past it, it is missed. A moved link needs a fresh approval.
      if (failureCode === SCHEDULE_TARGET_CHANGED) {
        await sql`update post_publication_schedule set status = 'blocked', status_reason = 'connection_changed', updated_at = now() where id = ${scheduleId} and status = 'active'`
        await emit(sql, {
          ...base(schedule),
          kind: "schedule_blocked",
          reason: "connection_changed",
          source: { type: "schedule_occurrence", id: run.id, scheduleId },
        })
        if (summary) summary.blocked += 1
      }
      if (
        failureCode === SCHEDULE_DEADLINE_PASSED ||
        Date.now() >= Date.parse(run.deadlineAt)
      ) {
        await markMissed(sql, schedule, run, "outside_dispatch_window", summary)
      } else {
        await sql`update post_publication_occurrence set status = 'scheduled', started_at = null where id = ${run.id} and status = 'publishing'`
      }
      if (failure)
        log.warn("post_schedule.publish_not_sent", {
          organisationId,
          scheduleId,
          occurrenceId: run.id,
          code: failureCode ?? "internal_error",
        })
      return
    }
    if (
      receipt.state === "failed" &&
      receipt.errorCode === SCHEDULE_DEADLINE_PASSED
    ) {
      await markMissed(sql, schedule, run, "outside_dispatch_window", summary)
      return
    }
    const outcome =
      receipt.state === "confirmed_applied" ||
      receipt.state === "awaiting_confirmation"
        ? "published"
        : receipt.state === "rejected" || receipt.state === "failed"
          ? "rejected"
          : "ambiguous"
    const reason =
      outcome === "published"
        ? null
        : outcome === "ambiguous"
          ? "response_ambiguous"
          : receipt.state === "rejected"
            ? "provider_rejected"
            : "publish_failed"
    await sql`update post_publication_occurrence set status = ${outcome}, status_reason = ${reason}, finished_at = now() where id = ${run.id}`
    const attempt = receipt.attemptId
    if (outcome === "rejected" && attempt) {
      // Google refusing the post (rejected) is not the same as the publish
      // failing on this side, before or around the send (failed: a
      // reconnect needed, a token error): the event says which.
      await emit(sql, {
        ...base(schedule),
        kind: "publication_failed",
        reason:
          receipt.state === "rejected" ? "provider_rejected" : "publish_failed",
        source: { type: "attempt", family: "posts", id: attempt },
      })
    }
    if (outcome === "ambiguous") {
      // Never resubmitted: mutation_recover reads Google back for the
      // uncertain receipt, and the tick's sweep
      // (settle_post_occurrences_from_receipts) settles this occurrence and
      // unblocks the schedule once it has an answer.
      // A schedule quarantined for review while this occurrence was in
      // flight (0116) keeps its needs_review state and wording; it already
      // never runs, and blocking it would hide why it stopped.
      const blocked =
        await sql`update post_publication_schedule set status = 'blocked', status_reason = 'prior_occurrence_unresolved', updated_at = now() where id = ${scheduleId} and status <> 'needs_review' returning id`
      if (attempt)
        await emit(sql, {
          ...base(schedule),
          kind: "publication_unresolved",
          reason: "response_ambiguous",
          source: { type: "attempt", family: "posts", id: attempt },
        })
      if (blocked.length > 0)
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

/**
 * Every tick, before the pause check and whatever the pauses say: records
 * occurrences whose window closed as missed (and raises schedule_missed in
 * each tenant for active or paused schedules), then settles unresolved
 * occurrences: from their own receipt once it has an answer, as missed when
 * none was recorded and the window has closed (nothing was sent), or, before
 * 0118, from their post. Neither sends anything to Google.
 */
export async function sweepScheduledOccurrences(): Promise<ScheduleSweepSummary> {
  const db = getDatabase()
  const missed = await db<MissedRow[]>`
    select organisation_id::text as "organisationId", occurrence_id::text as "occurrenceId", reason
    from mark_missed_post_occurrences()`
  const resolved = await db<
    { organisationId: string; occurrenceId: string; status: string }[]
  >`
    select organisation_id::text as "organisationId", occurrence_id::text as "occurrenceId", status
    from settle_post_occurrences_from_receipts()`
  // An unresolved occurrence that settled missed (never sent, or refused
  // for lateness) is reported like any other missed slot.
  await raiseMissed([
    ...missed,
    ...resolved
      .filter((row) => row.status === "missed")
      .map((row) => ({ ...row, reason: "outside_dispatch_window" as const })),
  ])
  // One from before 0118 that its post proves nothing about was cancelled
  // (outcome_unverified) and its schedule sent to review: a person checks
  // Google before it runs again (P08-R6).
  const unverified = await raiseUnverified(
    resolved.filter((row) => row.status === "cancelled")
  )
  const summary = {
    missed: missed.length,
    resolved: resolved.length,
    unverified,
  }
  if (summary.missed || summary.resolved)
    log.info("post_schedule.sweep", summary)
  return summary
}

/**
 * Raises schedule_blocked (prior_occurrence_unverified) for each schedule
 * the sweep sent to review that way, in its tenant. Returns how many.
 */
async function raiseUnverified(
  rows: { organisationId: string; occurrenceId: string }[]
) {
  let raised = 0
  const byOrganisation = new Map<string, string[]>()
  for (const row of rows)
    byOrganisation.set(row.organisationId, [
      ...(byOrganisation.get(row.organisationId) ?? []),
      row.occurrenceId,
    ])
  for (const [organisationId, ids] of byOrganisation) {
    await withTenant(organisationId, async (sql) => {
      const reviewed = await sql<
        { id: string; scheduleId: string; locationId: string }[]
      >`
        select o.id::text as id, o.schedule_id::text as "scheduleId", o.location_id::text as "locationId"
        from post_publication_occurrence o
        join post_publication_schedule s on s.id = o.schedule_id
        where o.id = any(${ids}::uuid[]) and o.status_reason = 'outcome_unverified'
          and s.status = 'needs_review' and s.status_reason = 'prior_occurrence_unverified'`
      for (const occurrence of reviewed) {
        await emit(sql, {
          ...eventBase(organisationId, occurrence.locationId),
          kind: "schedule_blocked",
          reason: "prior_occurrence_unverified",
          source: {
            type: "schedule_occurrence",
            id: occurrence.id,
            scheduleId: occurrence.scheduleId,
          },
        })
        raised += 1
      }
    }).catch((error: unknown) =>
      log.error("post_schedule.unverified_events_failed", {
        organisationId,
        error,
      })
    )
  }
  return raised
}

type MissedRow = {
  organisationId: string
  occurrenceId: string
  reason: MissedReason
}

/** Raises schedule_missed for swept occurrences, in each one's tenant. */
async function raiseMissed(rows: MissedRow[]) {
  const byOrganisation = new Map<string, MissedRow[]>()
  for (const row of rows)
    byOrganisation.set(row.organisationId, [
      ...(byOrganisation.get(row.organisationId) ?? []),
      row,
    ])
  for (const [organisationId, own] of byOrganisation) {
    const reasons = new Map(own.map((row) => [row.occurrenceId, row.reason]))
    await withTenant(organisationId, async (sql) => {
      const occurrences = await sql<
        {
          id: string
          scheduleId: string
          locationId: string
          intendedAt: Date
        }[]
      >`
        select id::text as id, schedule_id::text as "scheduleId", location_id::text as "locationId", intended_at as "intendedAt"
        from post_publication_occurrence where id = any(${[...reasons.keys()]}::uuid[])`
      for (const occurrence of occurrences)
        await emit(sql, {
          ...eventBase(organisationId, occurrence.locationId),
          kind: "schedule_missed",
          reason: reasons.get(occurrence.id)!,
          dueAt: occurrence.intendedAt.toISOString(),
          source: {
            type: "schedule_occurrence",
            id: occurrence.id,
            scheduleId: occurrence.scheduleId,
          },
        })
    }).catch((error: unknown) =>
      log.error("post_schedule.missed_events_failed", { organisationId, error })
    )
  }
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
    superseded: 0,
    sourceChanged: 0,
    sourceInFlight: 0,
    readOnly: 0,
  }
  const env = getServerEnv()
  const deadline = Date.now() + options.budgetMs
  // A schedule handled once this tick and due again was deferred with its
  // occurrence still scheduled (no link yet, or its draft being published
  // by hand): the next tick looks again. Re-running it now would only spin
  // until the budget ran out.
  const seen = new Set<string>()
  while (Date.now() + env.GOOGLE_TIMEOUT_MS <= deadline) {
    const claimed = await getDatabase()<
      { organisationId: string; scheduleId: string }[]
    >`
      select organisation_id::text as "organisationId", schedule_id::text as "scheduleId"
      from claim_due_publication_schedules(${env.JOBS_BATCH_SIZE}, ${Math.ceil(options.budgetMs / 1000) + 60}, ${env.JOBS_PER_ORGANISATION})`
    const fresh = claimed.filter((row) => !seen.has(row.scheduleId))
    for (const row of claimed)
      if (seen.has(row.scheduleId))
        await finish(row.organisationId, row.scheduleId).catch(() => undefined)
    if (!fresh.length) break
    for (const row of fresh) {
      // A schedule starts only while the slice lasts (the first always
      // does: the claim needed a whole provider call's worth). The rest are
      // released for the next tick with their occurrences still scheduled,
      // rather than run past the slice the job runner gave this runner.
      if (Date.now() >= deadline) {
        await finish(row.organisationId, row.scheduleId).catch(() => undefined)
        continue
      }
      seen.add(row.scheduleId)
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
  // One line per tick that did anything, for dashboards (P08-R6).
  if (summary.schedules > 0)
    log.info("post_schedule.tick", { requestId: options.requestId, ...summary })
  return summary
}
