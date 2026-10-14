/**
 * What a reply is, as facts rather than as a sentence.
 *
 * The narrative half of this module — `describeSituation`, its ten headline /
 * chip / detail outcomes and `situationFromReviewRow` — has moved to
 * lib/inbox/reply-state.ts, where the wording is derived from the same
 * `evaluate*` ladder the primary action obeys. Two vocabularies describing one
 * reply is how a list row came to say "Ready" beside a pane that said "Draft
 * saved"; there is now one.
 *
 * What is left here is the vocabulary the rest of the inbox reads off the wire:
 * the tone scale, the publish-status labels, and `replyWork`, which answers "is
 * there anything actually pending?" for the composer, the status and the footer
 * alike.
 */

import { describeOutcome } from "@/lib/editors/outcome"

export type SituationTone = "neutral" | "positive" | "caution" | "attention"

// --- Reply publication state -------------------------------------------

// `review_reply.publish_status` values (supabase/migrations/0001_initial.sql).
// The pane used to label every one of these "Your published reply", which is
// wrong for five of the six.
// The two that are Google outcomes take the shared outcome words
// (lib/editors/outcome.ts), so "Live on Google" means the same here as on
// every other surface.
const REPLY_STATE: Record<string, { label: string; tone: SituationTone }> = {
  published: {
    label: describeOutcome("confirmed_applied").label,
    tone: "positive",
  },
  accepted: { label: describeOutcome("sent").label, tone: "neutral" },
  awaiting_approval: { label: "Waiting for approval", tone: "caution" },
  rejected: { label: "Rejected", tone: "attention" },
  failed: { label: "Failed to publish", tone: "attention" },
  deleted: { label: "Deleted", tone: "neutral" },
  not_published: { label: "Not published", tone: "neutral" },
}

export function describeReplyState(publishStatus: string | null): {
  label: string
  tone: SituationTone
} {
  if (!publishStatus) return REPLY_STATE.not_published
  return (
    REPLY_STATE[publishStatus] ?? { label: "Not published", tone: "neutral" }
  )
}

/** The only status that means the reply is actually visible on Google. */
export function isLiveOnGoogle(
  publishStatus: string | null | undefined
): boolean {
  return publishStatus === "published"
}

// --- Is there any reply work left? -------------------------------------

export type ReplyWork = {
  /** What Google is showing right now, or null if nothing is live. */
  liveBody: string | null
  /**
   * The saved draft the pane shows (`shownDraft`), or null if none has been
   * saved.
   */
  draftBody: string | null
  /** A saved draft says something other than what is live. */
  hasUnpublishedChanges: boolean
  /**
   * A reply is live and no newer draft is waiting for it. There is nothing to
   * write and nothing to publish — the composer collapses and the footer drops
   * its Publish button rather than offering to re-send identical text.
   */
  settled: boolean
}

/** Reply text is on Google (confirmed) or submitted and awaiting Google's state. */
function hasReplyOnGoogle(publishStatus: string | null | undefined): boolean {
  return publishStatus === "published" || publishStatus === "accepted"
}

/**
 * The draft the pane shows: the parked one while the reply awaits approval
 * (it need not be the newest; see `pendingDraft` in lib/contracts/reviews.ts),
 * otherwise the newest. Approve names this draft, so the approver decides on
 * the text they read.
 */
export function shownDraft<D extends { body: string }>(review: {
  workflowStatus?: string
  pendingDraft?: { id: string; body: string } | null
  drafts: readonly D[]
}): D | { id: string; body: string } | undefined {
  if (review.workflowStatus === "awaiting_approval" && review.pendingDraft) {
    return review.pendingDraft
  }
  return review.drafts[0]
}

export function replyWork(review: {
  reply: { body: string | null; publishStatus: string | null } | null
  drafts: readonly { body: string }[]
  workflowStatus?: string
  pendingDraft?: { id: string; body: string } | null
}): ReplyWork {
  // `accepted` counts here so situation chips and the settled composer see
  // Google-synced / in-flight replies; delete and similar actions still use
  // the stricter `isLiveOnGoogle` (confirmed `published` only).
  const liveBody = hasReplyOnGoogle(review.reply?.publishStatus)
    ? (review.reply?.body ?? null)
    : null
  const draftBody = shownDraft(review)?.body ?? null
  const hasUnpublishedChanges = Boolean(
    draftBody !== null && liveBody !== null && draftBody !== liveBody
  )
  return {
    liveBody,
    draftBody,
    hasUnpublishedChanges,
    settled: liveBody !== null && !hasUnpublishedChanges,
  }
}
