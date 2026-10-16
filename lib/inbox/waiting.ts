import type { ReviewCounts } from "@/lib/contracts/reviews"
import { formatNumber } from "@/lib/format/number"

/**
 * What the Inbox has waiting on THIS person: reviews that need a reply, and
 * replies parked for their approval that they could approve (the server's
 * `approvableByMe`: not the person who asked, nor, under two-person approval,
 * the draft's author, and with publish permission). The two never overlap
 * (`needs_reply` and `awaiting_approval` are disjoint states), so the badge
 * and the page title count their sum.
 */
export type InboxWaiting = {
  needsReply: number
  awaitingMyApproval: number
  total: number
}

export function inboxWaiting(
  counts: ReviewCounts | undefined
): InboxWaiting | undefined {
  if (!counts) return undefined
  const needsReply = counts.byQueue.needs_reply ?? 0
  // A payload without the field is from a server that predates it: the queue
  // is then the closest count there is.
  const awaitingMyApproval =
    counts.approvableByMe ?? counts.byQueue.awaiting_my_approval ?? 0
  return {
    needsReply,
    awaitingMyApproval,
    total: needsReply + awaitingMyApproval,
  }
}

/**
 * The count in words, for a screen reader: "2 need a reply" while only
 * replies wait (the wording before approvers were counted), "1 awaiting your
 * approval", or both parts when both wait. `reviews` adds the noun the
 * sidebar's own label carries ("2 reviews need a reply").
 */
export function waitingPhrase(
  {
    needsReply,
    awaitingMyApproval,
  }: Pick<InboxWaiting, "needsReply" | "awaitingMyApproval">,
  { reviews = false }: { reviews?: boolean } = {}
): string {
  // One grouped figure, as the visible count beside it writes it, so a
  // screen reader never hears "1,0001000".
  const approval = awaitingMyApproval
  const total = needsReply + approval
  const n = formatNumber
  if (approval === 0) {
    const subject = reviews ? (needsReply === 1 ? "review" : "reviews") : null
    return subject
      ? `${n(needsReply)} ${subject} ${needsReply === 1 ? "needs" : "need"} a reply`
      : `${n(needsReply)} ${needsReply === 1 ? "needs" : "need"} a reply`
  }
  if (needsReply === 0) {
    return reviews
      ? `${n(approval)} ${approval === 1 ? "review awaits" : "reviews await"} your approval`
      : `${n(approval)} awaiting your approval`
  }
  return `${n(total)} ${reviews ? (total === 1 ? "review needs" : "reviews need") : total === 1 ? "needs" : "need"} your attention: ${n(needsReply)} to reply, ${n(approval)} to approve`
}
