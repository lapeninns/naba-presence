import type { LatestVerification, ReviewRow } from "@/lib/api/reviews"

// The old pane scattered its state across three surfaces that could disagree
// on sight: a workflow badge in the header, a verification verdict halfway
// down, and a Publish button whose availability was explained only in a
// `title` attribute. An operator had to reconcile them to answer the one
// question they actually have — "is there anything for me to do here?".
//
// This is the single answer. It is a pure function of the review so it can be
// tested exhaustively, and it always says both what the state IS and what to
// do about it.

export type SituationTone = "neutral" | "positive" | "caution" | "attention"

export type ReviewSituation = {
  tone: SituationTone
  /** A few words naming the state (detail strip). */
  headline: string
  /** Compact list-row chip; keeps the ~400px pane from wrapping. */
  chip: string
  /** One sentence: what it means, or what to do next. */
  detail: string
}

export type SituationInput = {
  workflowStatus: string
  /** Verdict of the latest draft; `null` before anything has been verified. */
  verification: LatestVerification | null
  /** A reply is live on Google right now. */
  hasLiveReply: boolean
  /** A saved draft differs from what is live. */
  hasUnpublishedChanges: boolean
  hasDraft: boolean
  hasVerifiedDraft: boolean
  canPublish: boolean
  canRequestApproval: boolean
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many.replace("{n}", String(count))
}

function situation(
  tone: SituationTone,
  headline: string,
  chip: string,
  detail: string
): ReviewSituation {
  return { tone, headline, chip, detail }
}

export function describeSituation(input: SituationInput): ReviewSituation {
  // In-flight and terminal workflow states outrank everything else: whatever
  // the draft looks like, the next move is dictated by where the reply is in
  // the pipeline.
  switch (input.workflowStatus) {
    case "failed":
      return situation(
        "attention",
        "Publishing failed",
        "Failed",
        "Google did not accept the last attempt. Edit the reply, then try again."
      )
    case "rejected":
      return situation(
        "attention",
        "Reply rejected",
        "Rejected",
        "This was sent back for changes. Edit the reply, then submit it again."
      )
    case "publish_requested":
      return situation(
        "neutral",
        "Publishing",
        "Sending",
        "Your reply is on its way to Google."
      )
    case "awaiting_approval":
      return situation(
        "caution",
        "Waiting for approval",
        "Approval",
        input.canPublish
          ? "Approve this reply to publish it, or reject it to send it back."
          : "A manager needs to approve this before it goes live."
      )
    case "escalated":
      return situation(
        "caution",
        "Escalated",
        "Escalated",
        "This review was flagged for a person to handle. Read it before replying."
      )
  }

  // A verdict only describes the draft in hand. Once a reply is live and no
  // newer draft exists, the last verification is history — reporting a stale
  // "Blocked" over a published reply would be a lie.
  const verdictApplies =
    input.hasDraft && (!input.hasLiveReply || input.hasUnpublishedChanges)
  const verdict = verdictApplies ? input.verification?.verdict : undefined
  const reasons = input.verification?.reasons ?? []

  if (verdict === "fail") {
    const blocking = reasons.filter((reason) => reason.severity === "fail").length
    return situation(
      "attention",
      "Blocked by verification",
      "Blocked",
      blocking
        ? plural(
            blocking,
            "One issue has to be fixed before this can be published.",
            "{n} issues have to be fixed before this can be published."
          )
        : "Verification blocked this reply. Fix the issues below, then re-verify."
    )
  }

  if (input.hasUnpublishedChanges) {
    return situation(
      "caution",
      "Unpublished changes",
      "Edited",
      "Your edit is not live yet. Publishing replaces the reply on Google."
    )
  }

  // `workflow_status = published` outranks a leftover verified draft: Google-
  // synced replies often sit at publish_status `accepted` (PENDING / no state)
  // while the review is already published — that must not read as "Ready to
  // publish".
  if (input.hasLiveReply || input.workflowStatus === "published") {
    return situation(
      "positive",
      "Published",
      "Live",
      "Your reply is live on Google."
    )
  }

  if (verdict === "warn") {
    const warnings = reasons.filter((reason) => reason.severity === "warn").length
    return situation(
      "caution",
      "Worth a second look",
      "Check",
      warnings
        ? plural(
            warnings,
            "Verification raised one point. You can still publish.",
            "Verification raised {n} points. You can still publish."
          )
        : "Verification raised a point. You can still publish."
    )
  }

  if (input.hasVerifiedDraft) {
    return situation(
      "positive",
      "Ready to publish",
      "Ready",
      // "Verified", not "passed": a `warn` draft also counts as publishable,
      // and this branch is reached when no verdict detail came back with the
      // review, so claiming a clean pass would overstate it.
      !input.canPublish && input.canRequestApproval
        ? "The draft has been verified. Send it for approval."
        : "The draft has been verified. Publish when you’re ready."
    )
  }

  if (input.hasDraft) {
    return situation(
      "neutral",
      "Draft saved",
      "Draft",
      "Verify the draft, then publish it."
    )
  }

  return situation(
    "neutral",
    "No reply yet",
    "New",
    "Write a reply, or generate one to start."
  )
}

// --- Reply publication state -------------------------------------------

// `review_reply.publish_status` values (supabase/migrations/0001_initial.sql).
// The pane used to label every one of these "Your published reply", which is
// wrong for five of the six.
const REPLY_STATE: Record<string, { label: string; tone: SituationTone }> = {
  published: { label: "Live on Google", tone: "positive" },
  accepted: { label: "Sent to Google", tone: "neutral" },
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
  return REPLY_STATE[publishStatus] ?? { label: "Not published", tone: "neutral" }
}

/** The only status that means the reply is actually visible on Google. */
export function isLiveOnGoogle(publishStatus: string | null | undefined): boolean {
  return publishStatus === "published"
}

// --- Is there any reply work left? -------------------------------------

export type ReplyWork = {
  /** What Google is showing right now, or null if nothing is live. */
  liveBody: string | null
  /** The newest saved draft, or null if none has been saved. */
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

export function replyWork(review: {
  reply: { body: string | null; publishStatus: string | null } | null
  drafts: readonly { body: string }[]
}): ReplyWork {
  // `accepted` counts here so situation chips and the settled composer see
  // Google-synced / in-flight replies; delete and similar actions still use
  // the stricter `isLiveOnGoogle` (confirmed `published` only).
  const liveBody = hasReplyOnGoogle(review.reply?.publishStatus)
    ? (review.reply?.body ?? null)
    : null
  const draftBody = review.drafts[0]?.body ?? null
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

// --- List row → same situation voice as the detail strip ---------------

const VERDICT_STATUSES = new Set(["pass", "warn", "fail"])
const VERIFIED_STATUSES = new Set(["pass", "warn"])

/**
 * Maps an inbox list row onto the same `describeSituation` answer the detail
 * pane uses, so operators never see "Verified" in the list and "Ready to
 * publish" in the pane for the same review. List rows only carry a verdict
 * string (no reason payloads), so fail/warn detail sentences stay generic.
 */
export function situationFromReviewRow(
  row: Pick<
    ReviewRow,
    | "workflowStatus"
    | "draftBody"
    | "replyBody"
    | "replyStatus"
    | "verificationStatus"
    | "capabilities"
  >
): ReviewSituation {
  const work = replyWork({
    reply: { body: row.replyBody, publishStatus: row.replyStatus },
    drafts: row.draftBody ? [{ body: row.draftBody }] : [],
  })
  const verification: LatestVerification | null =
    row.verificationStatus && VERDICT_STATUSES.has(row.verificationStatus)
      ? {
          verdict: row.verificationStatus as LatestVerification["verdict"],
          reasons: [],
        }
      : null

  return describeSituation({
    workflowStatus: row.workflowStatus,
    verification,
    hasLiveReply: work.liveBody !== null,
    hasUnpublishedChanges: work.hasUnpublishedChanges,
    hasDraft: work.draftBody !== null,
    hasVerifiedDraft: Boolean(
      row.verificationStatus && VERIFIED_STATUSES.has(row.verificationStatus)
    ),
    canPublish: row.capabilities.canPublish,
    canRequestApproval: row.capabilities.canRequestApproval,
  })
}
