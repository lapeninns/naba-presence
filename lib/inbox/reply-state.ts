import type { LatestVerification } from "@/lib/api/reviews"
import {
  evaluateApproval,
  evaluatePublish,
  evaluateRequestApproval,
} from "@/lib/inbox/actions"
import { replyWork, type SituationTone } from "@/lib/inbox/review-situation"

/**
 * One derivation of "where has this reply got to, and what can I do about it".
 *
 * The pane used to answer that question in three places that could disagree on
 * sight: a five-stage tracker across the top, a situation strip under it, and a
 * footer button whose availability was worked out separately. The tracker was
 * the worst of the three, because a stage lit up when publishing was merely the
 * NEXT available step — so "Published" appeared over a reply that had never
 * been sent.
 *
 * Everything here is computed from `derivePrimaryAction`, which is the same
 * `evaluate*` ladder in lib/inbox/actions.ts that the footer button obeys. The
 * status therefore cannot claim a state the action disagrees with: if it says
 * "Ready to publish", the button is live; if the button is off, the status
 * names the thing standing in the way.
 *
 * Policy lives in lib/inbox/actions.ts and on the server. This module only
 * decides how that policy READS.
 */

export type PrimaryActionKind = "publish" | "update" | "approve" | "submit"

/** A mutation this surface started and has not had an answer to yet. */
export type ReplyPendingKind =
  "publish" | "submit" | "approve" | "reject" | "save" | "generate"

export type ReplyStateInput = {
  workflowStatus: string
  capabilities: {
    canPublish: boolean
    canEdit: boolean
    canRequestApproval: boolean
  }
  reply: { body: string | null; publishStatus: string | null } | null
  drafts: readonly { body: string; verificationStatus: string | null }[]
  /** The latest verdict, with reasons when the surface has them. */
  verification: LatestVerification | null
  /** The composer is holding edits that are not saved. */
  isDirty: boolean
  pending?: ReplyPendingKind | null
  /**
   * Who an `awaiting_approval` reply is waiting on, when the caller knows it
   * authoritatively — which today means the server put the row in a queue that
   * says so.
   *
   * It is NOT derived from `capabilities.canPublish`. That is a location grant
   * and stays true for the very person who requested the approval, so under an
   * organisation's two-person rule it would announce "your approval is
   * required" on a reply this operator may not approve. In the aggregate
   * Approval queue nobody has told us, and `"unknown"` makes the row say
   * "Awaiting approval" rather than guess.
   */
  approvalScope?: "me" | "others" | "unknown"
}

export type PrimaryAction = {
  kind: PrimaryActionKind
  /** "Publish reply" / "Update reply" / "Approve reply" / "Submit for approval". */
  label: string
  enabled: boolean
  /** Why it is off. Always present when `enabled` is false. */
  reason?: string
  /**
   * A reply is live and the draft says the same words. There is nothing new to
   * send — distinct from "blocked", which is why it carries its own flag.
   */
  settled: boolean
  /** In-flight wording for the button while a mutation is running. */
  pendingLabel?: string
}

const ACTION_LABELS: Record<PrimaryActionKind, string> = {
  publish: "Publish reply",
  update: "Update reply",
  approve: "Approve reply",
  submit: "Submit for approval",
}

const PENDING_ACTION_LABELS: Partial<Record<ReplyPendingKind, string>> = {
  publish: "Publishing…",
  submit: "Submitting…",
  approve: "Approving…",
  reject: "Rejecting…",
}

const VERIFIED = new Set(["pass", "warn"])

/**
 * The NEWEST draft has been through verification with a verdict that permits
 * sending.
 *
 * Deliberately the newest one rather than "any verified draft in the list".
 * Drafts arrive newest-first and the composer edits `drafts[0]`, so a search
 * for the first verified draft could answer "yes" about an older one while the
 * operator reads an unverified newer draft — and the publish would then send
 * text that is not on screen. "Ready to publish" has to mean the saved, checked
 * draft the operator can actually read.
 */
export function hasVerifiedDraft(
  drafts: readonly { verificationStatus: string | null }[]
): boolean {
  const latest = drafts[0]
  return Boolean(
    latest?.verificationStatus && VERIFIED.has(latest.verificationStatus)
  )
}

/** The draft a publish should send: the newest, and only when it is verified. */
export function publishableDraft<
  T extends { verificationStatus: string | null },
>(drafts: readonly T[]): T | undefined {
  return hasVerifiedDraft(drafts) ? drafts[0] : undefined
}

/**
 * Which action applies, whether it is available, and why not.
 *
 * The branch order mirrors the footer exactly: an approval decision outranks
 * everything, a non-publisher who may request approval submits instead of
 * publishes, and otherwise the verb follows whether anything is already live.
 */
export function derivePrimaryAction(input: ReplyStateInput): PrimaryAction {
  const work = replyWork({ reply: input.reply, drafts: input.drafts })
  const verified = hasVerifiedDraft(input.drafts)
  const awaitingApproval = input.workflowStatus === "awaiting_approval"
  // A non-publisher who may request approval submits rather than publishes;
  // the server routes their publish to `awaiting_approval` either way, so the
  // wording is what changes, not the call.
  const offerRequestApproval =
    !input.capabilities.canPublish && input.capabilities.canRequestApproval

  const kind: PrimaryActionKind = awaitingApproval
    ? "approve"
    : offerRequestApproval
      ? "submit"
      : work.liveBody !== null
        ? "update"
        : "publish"

  const availability = awaitingApproval
    ? evaluateApproval({
        status: input.workflowStatus,
        canPublish: input.capabilities.canPublish,
      })
    : offerRequestApproval
      ? evaluateRequestApproval({
          status: input.workflowStatus,
          canRequestApproval: input.capabilities.canRequestApproval,
          hasVerifiedDraft: verified,
          isDirty: input.isDirty,
        })
      : evaluatePublish({
          status: input.workflowStatus,
          canPublish: input.capabilities.canPublish,
          hasVerifiedDraft: verified,
          isDirty: input.isDirty,
        })

  // `work` is server state, so it still reads "settled" while the composer
  // holds unsaved edits — without the dirty check the pane would tell you to
  // edit a reply you are in the middle of editing.
  const settled = work.settled && !input.isDirty && !awaitingApproval
  const pending = input.pending ?? null

  return {
    kind,
    label: ACTION_LABELS[kind],
    settled,
    enabled: availability.enabled && !settled && !pending,
    reason: pending
      ? undefined
      : settled
        ? "Edit the reply above to publish a change."
        : availability.enabled
          ? undefined
          : (availability.reason ??
            "This reply cannot be sent from its current status."),
    pendingLabel: pending ? PENDING_ACTION_LABELS[pending] : undefined,
  }
}

// --- The one compact status -------------------------------------------------

export type ReplyStatusIcon =
  | "loader"
  | "cloud"
  | "check"
  | "check-circle"
  | "clock"
  | "alert"
  | "pen"
  | "lock"
  | "circle"

export type ReplyStatus = {
  /** The sentence the detail pane shows. */
  text: string
  /** The two or three words a ~400px list row can hold. */
  short: string
  tone: SituationTone
  icon: ReplyStatusIcon
  /** A muted qualifier after the sentence on the publish bar. */
  note?: string
}

function status(
  text: string,
  short: string = text,
  tone: SituationTone = "neutral",
  icon: ReplyStatusIcon = "circle",
  note?: string
): ReplyStatus {
  return note ? { text, short, tone, icon, note } : { text, short, tone, icon }
}

// Publish saves and checks the text first, so a reply that is written but not
// yet checked is still ready: the check is part of the press.
const CHECKED_ON_PUBLISH = "checked when you publish"

function readyText(kind: PrimaryActionKind): string {
  return kind === "update"
    ? "Ready to update"
    : kind === "submit"
      ? "Ready to submit for approval"
      : "Ready to publish"
}

const PENDING_STATUS: Record<ReplyPendingKind, [string, string]> = {
  publish: ["Publishing reply", "Publishing"],
  submit: ["Submitting for approval", "Submitting"],
  approve: ["Recording your approval", "Approving"],
  reject: ["Sending the reply back", "Rejecting"],
  save: ["Saving and checking the draft", "Saving draft"],
  generate: ["Generating a draft", "Generating"],
}

/**
 * ONE status line, derived from the same conditions as the primary action.
 *
 * The ordering is "what stops me acting, soonest first". Two rules are load
 * bearing and neither may be relaxed for a tidier ladder:
 *
 *  1. "Live on Google" is reachable ONLY from `publish_status = 'published'`
 *     (via `replyWork`'s stricter sibling below). A queued or `accepted`
 *     provider request is in flight, not confirmed, and says so.
 *  2. Nothing here infers a state from the availability of an action. Being
 *     ABLE to publish is "Ready to publish"; it is never "Published".
 */
export function deriveReplyStatus(input: ReplyStateInput): ReplyStatus {
  const action = derivePrimaryAction(input)
  const work = replyWork({ reply: input.reply, drafts: input.drafts })
  const publishStatus = input.reply?.publishStatus ?? null

  if (input.pending) {
    const [text, short] = PENDING_STATUS[input.pending]
    return status(text, short, "neutral", "loader")
  }

  // In-flight state outranks everything: whatever the composer holds, nobody
  // can act while a publish is on its way to Google.
  if (input.workflowStatus === "publish_requested") {
    return status("Publishing reply", "Publishing", "neutral", "cloud")
  }

  // Approval outranks unsaved edits, because the action on offer is Approve and
  // `evaluateApproval` does not care whether the composer is dirty. Telling an
  // approver to save a draft while a live Approve button sits beneath them is
  // exactly the kind of disagreement this module exists to prevent.
  if (input.workflowStatus === "awaiting_approval") {
    const scope = input.approvalScope ?? "unknown"
    if (scope === "unknown") {
      return status(
        "Waiting for approval",
        "Awaiting approval",
        "caution",
        "clock"
      )
    }
    return scope === "me"
      ? status("Approval required", "For approval", "caution", "check-circle")
      : status(
          "Waiting for another approver",
          "Awaiting approval",
          "caution",
          "clock"
        )
  }

  // Unsaved edits outrank a past failure: the next press saves, checks and
  // sends them, and the failure keeps its own place in the exception block
  // beneath the reply. Someone who may neither publish nor ask for approval
  // is told so rather than offered a step they cannot take.
  if (input.isDirty) {
    if (
      !input.capabilities.canPublish &&
      !input.capabilities.canRequestApproval
    ) {
      return status("Publisher needed", "Publisher needed", "caution", "lock")
    }
    return status(
      readyText(action.kind),
      "Unsaved changes",
      "neutral",
      "pen",
      CHECKED_ON_PUBLISH
    )
  }

  if (input.workflowStatus === "failed") {
    return status("Publish failed", "Publish failed", "attention", "alert")
  }
  if (input.workflowStatus === "rejected") {
    return status("Sent back for changes", "Sent back", "caution", "pen")
  }

  // Confirmed publication only. `accepted` means Google took the request and
  // has not yet told us what became of it.
  if (action.settled) {
    return publishStatus === "published"
      ? status("Live on Google", "Replied", "neutral", "check-circle")
      : status(
          "Sent to Google",
          "Sent",
          "neutral",
          "cloud",
          "not live until Google confirms"
        )
  }

  if (work.draftBody === null && work.liveBody === null) {
    return status("No reply yet", "Needs reply")
  }

  const verdict = input.verification?.verdict
  if (verdict === "fail") {
    return status(
      "Draft needs a correction",
      "Check needed",
      "attention",
      "alert"
    )
  }

  if (!hasVerifiedDraft(input.drafts)) {
    return status(
      readyText(action.kind),
      "Check draft",
      "neutral",
      "circle",
      CHECKED_ON_PUBLISH
    )
  }

  if (!action.enabled) {
    // Everything actionable has been ruled out above, so what is left is a
    // permission or transition wall. Say which, rather than implying the
    // operator has something to fix.
    return input.capabilities.canPublish ||
      input.capabilities.canRequestApproval
      ? status("Cannot be sent yet", "Not ready", "caution", "alert")
      : status("Publisher needed", "Publisher needed", "caution", "lock")
  }

  if (action.kind === "submit") {
    return status(
      "Draft checked · Approval required",
      "Approval required",
      "caution",
      "check-circle"
    )
  }

  if (verdict === "warn") {
    return status(
      action.kind === "update"
        ? "Checked with a note · Ready to update"
        : "Checked with a note · Ready to publish",
      action.kind === "update" ? "Update ready" : "Ready to publish",
      "caution",
      "alert"
    )
  }

  return status(
    action.kind === "update"
      ? "Draft checked · Ready to update"
      : "Draft checked · Ready to publish",
    action.kind === "update" ? "Update ready" : "Ready to publish",
    "neutral",
    "check"
  )
}

// --- List rows --------------------------------------------------------------

/**
 * A list row onto the same answer the detail pane gives.
 *
 * Rows carry a verdict string but no reason payloads and no composer, so
 * `isDirty` is false and the verification has an empty `reasons`. Every other
 * input is the same field, so the row's word and the pane's sentence come from
 * one ladder.
 */
export function replyStateFromRow(
  row: {
    workflowStatus: string
    draftBody: string | null
    replyBody: string | null
    replyStatus: string | null
    verificationStatus: string | null
    capabilities: {
      canPublish: boolean
      canEdit: boolean
      canRequestApproval: boolean
    }
  },
  /**
   * The queue the rows were fetched under. `awaiting_my_approval` and
   * `awaiting_others` are server-scoped, so they are the authoritative answer
   * to "who is this waiting on"; anything else leaves it unknown.
   */
  queue?: string
): ReplyStateInput {
  const verdict = row.verificationStatus
  return {
    workflowStatus: row.workflowStatus,
    capabilities: row.capabilities,
    reply: { body: row.replyBody, publishStatus: row.replyStatus },
    drafts: row.draftBody
      ? [{ body: row.draftBody, verificationStatus: verdict }]
      : [],
    verification:
      verdict === "pass" || verdict === "warn" || verdict === "fail"
        ? { verdict, reasons: [] }
        : null,
    isDirty: false,
    approvalScope:
      queue === "awaiting_my_approval"
        ? "me"
        : queue === "awaiting_others"
          ? "others"
          : "unknown",
  }
}
