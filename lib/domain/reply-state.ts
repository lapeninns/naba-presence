const KNOWN_STATES = new Set(["PENDING", "APPROVED", "REJECTED"])

type ReplyModerationState = "PENDING" | "APPROVED" | "REJECTED"

export function parseReplyModeration(
  review: Record<string, unknown>
): {
  state: ReplyModerationState | null
  policyViolation: string | null
  comment: string | null
  updateTime: string | null
} {
  const reply =
    typeof review.reviewReply === "object" && review.reviewReply !== null
      ? (review.reviewReply as Record<string, unknown>)
      : null
  const rawState =
    (typeof review.reviewReplyState === "string" &&
      review.reviewReplyState) ||
    (reply && typeof reply.state === "string" && reply.state) ||
    null
  const rawViolation =
    (typeof review.policyViolation === "string" &&
      review.policyViolation) ||
    (reply && reply.policyViolation !== undefined
      ? JSON.stringify(reply.policyViolation)
      : null)
  return {
    state:
      rawState && KNOWN_STATES.has(rawState)
        ? (rawState as ReplyModerationState)
        : null,
    policyViolation: rawViolation,
    comment:
      reply && typeof reply.comment === "string" ? reply.comment : null,
    updateTime:
      reply && typeof reply.updateTime === "string"
        ? reply.updateTime
        : null,
  }
}
