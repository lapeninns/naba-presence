/**
 * Where a notification about one review's reply leads: the review in the
 * Inbox (`?selected=`, as the bulk view links it). A request opens over the
 * Approval queue, a send-back over Needs reply, where the review now sits.
 * Two kinds lead elsewhere: a topic alert (S3) to the venue's reviews on
 * that topic, and a listing changed on Google (S5) to the listing's
 * suggestions tab, where ours and Google's are decided. Null for every other
 * kind, and for a summary without the id it needs. Client safe: the emails
 * (lib/server/notifications/messages.ts) and the Notifications list share it.
 */
export function reviewNotificationPath(
  kind: string,
  summary: Record<string, unknown>
): string | null {
  // S3: a topic alert opens the venue's reviews on that topic.
  if (kind === "review_topic_negative") return reviewTopicInboxPath(summary)
  // S5: a protected field changed on Google is decided on the suggestions tab.
  if (kind === "listing_google_changed") return listingSuggestionsPath(summary)
  const reviewId = summary.reviewId
  if (typeof reviewId !== "string" || !/^[0-9a-f-]{36}$/i.test(reviewId))
    return null
  const selected = encodeURIComponent(reviewId)
  if (kind === "approval_requested")
    return `/inbox?queue=approval&selected=${selected}`
  if (kind === "reply_sent_back") return `/inbox?selected=${selected}`
  return null
}

function reviewTopicInboxPath(summary: Record<string, unknown>): string | null {
  const { locationId, topic } = summary
  if (typeof locationId !== "string" || !/^[0-9a-f-]{36}$/i.test(locationId))
    return null
  if (typeof topic !== "string" || !/^[a-z_]{1,40}$/.test(topic)) return null
  return `/inbox?queue=all&locationId=${encodeURIComponent(locationId)}&topic=${topic}`
}

function listingSuggestionsPath(
  summary: Record<string, unknown>
): string | null {
  const { locationId } = summary
  if (typeof locationId !== "string" || !/^[0-9a-f-]{36}$/i.test(locationId))
    return null
  return `/listings/${locationId}/suggestions`
}
