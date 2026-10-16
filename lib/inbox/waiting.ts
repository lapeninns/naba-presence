import type { ReviewCounts } from "@/lib/contracts/reviews"

/**
 * What the Inbox has waiting on THIS person: reviews that need a reply, and
 * replies parked for their approval (the server's own `awaiting_my_approval`
 * queue, which is empty for anyone who cannot approve). The two queues never
 * overlap, so the badge and the page title count their sum.
 */
export type InboxWaiting = {
  needsReply: number
  approval: number
  total: number
}

export function inboxWaiting(
  counts: ReviewCounts | undefined
): InboxWaiting | undefined {
  if (!counts) return undefined
  const needsReply = counts.byQueue.needs_reply ?? 0
  const approval = counts.byQueue.awaiting_my_approval ?? 0
  return { needsReply, approval, total: needsReply + approval }
}

/**
 * The count in words, for a screen reader: "2 need a reply" while only
 * replies wait (the wording before approvers were counted), "1 awaiting your
 * approval", or both parts when both wait. `reviews` adds the noun the
 * sidebar's own label carries ("2 reviews need a reply").
 */
export function waitingPhrase(
  { needsReply, approval }: Pick<InboxWaiting, "needsReply" | "approval">,
  { reviews = false }: { reviews?: boolean } = {}
): string {
  const total = needsReply + approval
  if (approval === 0) {
    const subject = reviews ? (needsReply === 1 ? "review" : "reviews") : null
    return subject
      ? `${needsReply} ${subject} ${needsReply === 1 ? "needs" : "need"} a reply`
      : `${needsReply} ${needsReply === 1 ? "needs" : "need"} a reply`
  }
  if (needsReply === 0) {
    return reviews
      ? `${approval} ${approval === 1 ? "review awaits" : "reviews await"} your approval`
      : `${approval} awaiting your approval`
  }
  return `${total} ${reviews ? (total === 1 ? "review needs" : "reviews need") : total === 1 ? "needs" : "need"} your attention: ${needsReply} to reply, ${approval} to approve`
}
