import "server-only"

import type { TransactionSql } from "postgres"

import type { LocationScope } from "@/lib/contracts/members"
import { memberGrant } from "@/lib/server/permissions"

import { queueDeliveries } from "./evaluate"

/**
 * The approval notifications (INB-05, 0149), recorded inside the tenant
 * transaction that parks or rejects the reply, so a rolled-back decision
 * leaves no notification behind.
 *
 *   approval_requested  opened when a reply is parked for approval
 *                       (publishing/approval.ts). Addressed to everyone who
 *                       could approve it: publish permission at the review's
 *                       location, never the person who asked, and under
 *                       two-person approval never the parked draft's author
 *                       (review-approval.ts refuses both).
 *   reply_sent_back     opened when an approver rejects it
 *                       (review-approval.ts). Addressed to the person who
 *                       asked, unless they rejected it themselves.
 *
 * Both are keyed by the review, so one review has at most one open incident
 * of each kind. A decision resolves the request, a new request resolves the
 * send-back, and evaluateOrganisation (evaluate.ts) resolves whichever the
 * reply has moved past by any other route. The summary holds the listing title and ids only:
 * never the review, the reply or a person's name.
 */

type ReviewContext = {
  locationId: string
  title: string | null
  twoPerson: boolean
}

export const approvalSubjectId = (organisationId: string, reviewId: string) =>
  `${organisationId}:review:${reviewId}`

async function reviewContext(
  sql: TransactionSql,
  reviewId: string
): Promise<ReviewContext | null> {
  const [row] = await sql<ReviewContext[]>`
    select r.location_id::text as "locationId", l.name as title,
      o.require_two_person_approval as "twoPerson"
    from review r
    join location l on l.id = r.location_id
    join organisation o on o.id = r.organisation_id
    where r.id = ${reviewId}`
  return row ?? null
}

/**
 * Who could approve a reply at `locationId`: the canPublish half of
 * memberGrant (permissions.ts) for every current member, so this list and
 * the approval route's own check share one rule.
 */
export async function approverIds(
  sql: TransactionSql,
  locationId: string
): Promise<string[]> {
  const rows = await sql<
    {
      userId: string
      role: "owner" | "admin" | "member" | "viewer"
      canPublish: boolean
      locationScope: LocationScope | null
      assignedPublish: boolean | null
    }[]
  >`
    select m.user_id::text as "userId", m.role, m.can_publish as "canPublish",
      m.location_scope as "locationScope",
      (
        select lm.can_publish from location_member lm
        where lm.organisation_id = m.organisation_id
          and lm.user_id = m.user_id and lm.location_id = ${locationId}
      ) as "assignedPublish"
    from member m
    where m.organisation_id =
      nullif(current_setting('app.organisation_id', true), '')::uuid`
  return rows
    .filter(
      (row) =>
        memberGrant({
          role: row.role,
          sessionCanPublish: row.canPublish,
          locationScope: row.locationScope,
          assignedPublish: row.assignedPublish,
        }).canPublish
    )
    .map((row) => row.userId)
}

async function resolveOpen(
  sql: TransactionSql,
  kind: "approval_requested" | "reply_sent_back",
  subjectId: string
) {
  await sql`
    update notification_incident set status = 'resolved', resolved_at = now()
    where kind = ${kind} and subject_id = ${subjectId} and status = 'open'`
}

/**
 * Opens (or, while one is open, re-addresses) the review's incident of
 * `kind`. Only a newly opened incident queues email, so a repeated request
 * never emails the same person twice.
 */
async function openAddressed(
  sql: TransactionSql,
  input: {
    organisationId: string
    reviewId: string
    kind: "approval_requested" | "reply_sent_back"
    context: ReviewContext
    recipients: readonly string[]
  }
) {
  const subjectId = approvalSubjectId(input.organisationId, input.reviewId)
  const summary = {
    title: input.context.title,
    locationId: input.context.locationId,
    reviewId: input.reviewId,
  }
  const [row] = await sql<{ id: string; inserted: boolean }[]>`
    insert into notification_incident (organisation_id, kind, subject_type, subject_id, summary, location_id)
    values (${input.organisationId}, ${input.kind}, 'review', ${subjectId}, ${sql.json(summary)}, ${input.context.locationId})
    on conflict (organisation_id, kind, subject_id) where status = 'open'
    do update set last_seen_at = now(), summary = excluded.summary
    returning id::text as id, (xmax = 0) as inserted`
  if (!row) return null
  await sql`delete from notification_incident_recipient where incident_id = ${row.id}`
  if (input.recipients.length) {
    await sql`
      insert into notification_incident_recipient (organisation_id, incident_id, user_id)
      select ${input.organisationId}, ${row.id}, unnest(${[...input.recipients]}::uuid[])
      on conflict (incident_id, user_id) do nothing`
  }
  if (row.inserted) await queueDeliveries(sql, input.organisationId, [row.id])
  return { incidentId: row.id, opened: row.inserted }
}

/** A reply was parked for approval by `requestedBy`, binding `draftId`. */
export async function notifyApprovalRequested(
  sql: TransactionSql,
  input: {
    organisationId: string
    reviewId: string
    requestedBy: string
    draftId: string
  }
) {
  const context = await reviewContext(sql, input.reviewId)
  if (!context) return null
  const subjectId = approvalSubjectId(input.organisationId, input.reviewId)
  // Submitting again answers the send-back.
  await resolveOpen(sql, "reply_sent_back", subjectId)
  const [draft] = context.twoPerson
    ? await sql<{ createdBy: string | null }[]>`
        select created_by::text as "createdBy" from draft where id = ${input.draftId}`
    : []
  const excluded = new Set([input.requestedBy, draft?.createdBy ?? null])
  const recipients = (await approverIds(sql, context.locationId)).filter(
    (userId) => !excluded.has(userId)
  )
  return openAddressed(sql, {
    organisationId: input.organisationId,
    reviewId: input.reviewId,
    kind: "approval_requested",
    context,
    recipients,
  })
}

/**
 * An approval decision on the review. Either decision closes the request;
 * a rejection also tells the person who asked, unless they rejected it.
 */
export async function notifyApprovalDecided(
  sql: TransactionSql,
  input: {
    organisationId: string
    reviewId: string
    decision: "approved" | "rejected"
    decidedBy: string
    requestedBy: string | null
  }
) {
  const subjectId = approvalSubjectId(input.organisationId, input.reviewId)
  await resolveOpen(sql, "approval_requested", subjectId)
  if (
    input.decision !== "rejected" ||
    !input.requestedBy ||
    input.requestedBy === input.decidedBy
  )
    return null
  const context = await reviewContext(sql, input.reviewId)
  if (!context) return null
  return openAddressed(sql, {
    organisationId: input.organisationId,
    reviewId: input.reviewId,
    kind: "reply_sent_back",
    context,
    recipients: [input.requestedBy],
  })
}
