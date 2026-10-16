/**
 * Where a notification about one review's reply leads: the review in the
 * Inbox (`?selected=`, as the bulk view links it). A request opens over the
 * Approval queue, a send-back over Needs reply, where the review now sits.
 * Null for every other kind, and for a summary without a review id. Client
 * safe: the emails (lib/server/notifications/messages.ts) and the
 * Notifications list share it.
 */
export function reviewNotificationPath(
  kind: string,
  summary: Record<string, unknown>
): string | null {
  const reviewId = summary.reviewId
  if (typeof reviewId !== "string" || !/^[0-9a-f-]{36}$/i.test(reviewId))
    return null
  const selected = encodeURIComponent(reviewId)
  if (kind === "approval_requested")
    return `/inbox?queue=approval&selected=${selected}`
  if (kind === "reply_sent_back") return `/inbox?selected=${selected}`
  return null
}
