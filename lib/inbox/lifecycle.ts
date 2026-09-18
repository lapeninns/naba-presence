import type { ReviewDetail } from "@/lib/contracts/reviews"
import { isLiveOnGoogle } from "@/lib/inbox/review-situation"

/**
 * The reply's journey, as five states.
 *
 * The lifecycle was implied before: an operator had to read a status word, a
 * verification badge and an activity list and assemble the story themselves.
 * Publishing is the one irreversible thing this product does, so where a reply
 * has got to, and who moved it, belongs on screen as a single line.
 *
 * Pure, and derived from the detail payload alone — nothing here needs a
 * request of its own.
 */
export type LifecycleStepId =
  | "received"
  | "drafted"
  | "verified"
  | "approved"
  | "published"

export type LifecycleStepState =
  | "done"
  | "current"
  | "todo"
  /** Legitimately not part of this reply's path, e.g. approval when off. */
  | "skipped"
  | "failed"

export type LifecycleStep = {
  id: LifecycleStepId
  label: string
  state: LifecycleStepState
  /** Who and when, or why it is stuck. Never a provider code. */
  meta?: string
}

type Review = ReviewDetail["review"]

export function actorFor(review: Review, actions: string[]): string | null {
  // The route orders audit rows `created_at desc`, so the array arrives
  // NEWEST-first and the first match is the most recent actor. This used to
  // walk from the end, which returned the oldest — naming the wrong person on
  // any review that had been re-drafted or approved more than once.
  for (const entry of review.timeline) {
    if (actions.includes(entry.action)) return entry.actorName ?? null
  }
  return null
}

export function deriveLifecycle(review: Review): LifecycleStep[] {
  const status = review.workflowStatus
  const latestDraft = review.drafts.at(0) ?? null
  const verification = review.latestVerification
  const reply = review.reply
  // `published`, never "there is a reply body": a failed or rejected publish
  // leaves a body behind, and `settle()` below would then back-fill every
  // earlier step to done — a completed pipeline drawn over a reply that never
  // went live. Publication is claimed only when the provider confirmed it.
  const isPublished =
    status === "published" || isLiveOnGoogle(reply?.publishStatus)
  const failed = status === "failed"

  const drafter = actorFor(review, ["review.draft.created", "review.draft.saved"])
  const approver = actorFor(review, ["review.approval.approved"])
  const rejected = actorFor(review, ["review.approval.rejected"])

  const steps: LifecycleStep[] = []

  steps.push({
    id: "received",
    label: "Received",
    state: "done",
    meta: "From Google",
  })

  steps.push({
    id: "drafted",
    label: "Drafted",
    state: latestDraft ? "done" : status === "new" ? "current" : "todo",
    meta: latestDraft
      ? [latestDraft.source === "ai" ? "AI" : "Written", drafter]
          .filter(Boolean)
          .join(" · ")
      : "No reply written yet",
  })

  const verdict = verification?.verdict
  steps.push({
    id: "verified",
    label: "Verified",
    state: !latestDraft
      ? "todo"
      : verdict === "fail"
        ? "failed"
        : verdict
          ? "done"
          : "current",
    meta:
      verdict === "fail"
        ? "Blocked — see the notes below"
        : verdict === "warn"
          ? `${verification?.reasons.length ?? 0} note${
              (verification?.reasons.length ?? 0) === 1 ? "" : "s"
            }`
          : verdict === "pass"
            ? "No issues found"
            : latestDraft
              ? "Not checked yet"
              : undefined,
  })

  // Approval is only a step when this reply actually needs one. Showing it as
  // "todo" for an organisation that publishes directly would describe a gate
  // that does not exist.
  const needsApproval =
    status === "awaiting_approval" || Boolean(approver) || Boolean(rejected)
  steps.push({
    id: "approved",
    label: "Approved",
    state: rejected
      ? "failed"
      : approver
        ? "done"
        : status === "awaiting_approval"
          ? "current"
          : needsApproval
            ? "todo"
            : "skipped",
    meta: rejected
      ? `Sent back by ${rejected}`
      : approver
        ? `By ${approver}`
        : status === "awaiting_approval"
          ? "Waiting for an approver"
          : needsApproval
            ? undefined
            : "Not required",
  })

  steps.push({
    id: "published",
    label: "Published",
    state: isPublished
      ? "done"
      : failed
        ? "failed"
        : status === "publish_requested"
          ? "current"
          : "todo",
    meta: isPublished
      ? "Live on Google"
      : failed
        ? "Google rejected it"
        : status === "publish_requested"
          ? "On its way to Google"
          : undefined,
  })

  return settle(steps)
}

/**
 * A linear pipeline cannot have a pending step behind a completed one.
 *
 * A published reply necessarily passed verification, even when the detail
 * payload carries no verification record — an old reply, or one published
 * before the record was kept. Left alone the strip would say "Verified: not
 * checked yet" under a reply that is live on Google, which reads as a fault
 * in the very place an operator looks to confirm there is none.
 */
function settle(steps: LifecycleStep[]): LifecycleStep[] {
  const lastDone = steps.reduce(
    (latest, step, index) => (step.state === "done" ? index : latest),
    -1
  )
  return steps.map((step, index) => {
    if (index >= lastDone) return step
    if (step.state === "current" || step.state === "todo") {
      return { ...step, state: "done", meta: step.meta }
    }
    return step
  })
}

/**
 * One sentence naming where the reply is, for a screen reader and for the
 * mobile layout where the strip is scrolled out of view.
 */
export function lifecycleSummary(steps: LifecycleStep[]): string {
  const failedStep = steps.find((step) => step.state === "failed")
  if (failedStep) return `${failedStep.label}: ${failedStep.meta ?? "needs attention"}`
  const current = steps.find((step) => step.state === "current")
  if (current) return `${current.label}: ${current.meta ?? "in progress"}`
  const published = steps.find((step) => step.id === "published")
  if (published?.state === "done") return "Published to Google"
  return "Waiting to be drafted"
}
