import "server-only"

/**
 * Approval routing. Human approval is enabled for every new organisation:
 * a member without publish rights, or any publisher in two-person mode
 * without a qualifying second approver, parks the reply as
 * `awaiting_approval` instead of starting a mutation intent. The approval
 * route later re-enters `executePublish` as the approver.
 */

import type { TransactionSql } from "postgres"

import { writeAudit } from "@/lib/server/audit"

import type { PublishInput, PublishOutcome } from "./types"

export type ApprovalPolicy = {
  approval_required: boolean
  require_two_person_approval: boolean
  has_qualifying_approval: boolean
}

export function requiresApproval(
  record: ApprovalPolicy,
  canPublish: boolean
): boolean {
  return (
    (!canPublish && record.approval_required) ||
    (record.require_two_person_approval && !record.has_qualifying_approval)
  )
}

/** Park the reply as `awaiting_approval` and record who asked. */
export async function requestApproval(
  sql: TransactionSql,
  input: PublishInput,
  body: string
): Promise<PublishOutcome> {
  await sql`
    update review
    set workflow_status = 'awaiting_approval'
    where id = ${input.reviewId}
  `
  const [reply] = await sql<{ id: string }[]>`
    insert into review_reply (
      organisation_id,
      review_id,
      current_body,
      publish_status,
      approval_requested_by
    )
    values (
      ${input.organisationId},
      ${input.reviewId},
      ${body},
      'awaiting_approval',
      ${input.session.userId}
    )
    on conflict (organisation_id, review_id) do update
    set
      current_body = excluded.current_body,
      publish_status = 'awaiting_approval',
      approval_requested_by = excluded.approval_requested_by
    returning id::text as id
  `
  await writeAudit(sql, {
    organisationId: input.organisationId,
    actorUserId: input.session.userId,
    action: "review.approval.requested",
    subjectType: "review",
    subjectId: input.reviewId,
    requestId: input.requestId,
    metadata: { draftId: input.draftId },
  })
  return {
    status: "awaiting_approval",
    googleReplyState: null,
    attemptId: reply.id,
    reviewReplyId: reply.id,
  }
}
