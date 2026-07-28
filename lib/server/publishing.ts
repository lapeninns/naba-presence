import "server-only"

import type { TransactionSql } from "postgres"

export async function writePublishAttemptEvent(
  sql: TransactionSql,
  input: {
    organisationId: string
    publishAttemptId: string
    eventType:
      | "started"
      | "provider_accepted"
      | "provider_rejected"
      | "retry_scheduled"
      | "ambiguity_checked"
      | "completed"
    payload?: Record<string, unknown>
  }
) {
  await sql`
    insert into publish_attempt_event (
      organisation_id,
      publish_attempt_id,
      event_type,
      payload
    )
    values (
      ${input.organisationId},
      ${input.publishAttemptId},
      ${input.eventType},
      ${sql.json(JSON.parse(JSON.stringify(input.payload ?? {})))}
    )
  `
}

export function googleReplyFromReview(review: Record<string, unknown>) {
  return review.reviewReply && typeof review.reviewReply === "object"
    ? (review.reviewReply as Record<string, unknown>)
    : null
}

export function googleReplyMatches(
  review: Record<string, unknown>,
  expectedBody: string
) {
  const reply = googleReplyFromReview(review)
  return typeof reply?.comment === "string" && reply.comment === expectedBody
}
