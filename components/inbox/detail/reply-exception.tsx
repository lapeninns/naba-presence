"use client"

import { useId, useState } from "react"
import { ChevronDownIcon } from "lucide-react"

import { deriveLifecycle, type LifecycleStep } from "@/lib/inbox/lifecycle"
import type { PrimaryAction } from "@/lib/inbox/reply-state"
import type { ReviewDetail } from "@/lib/contracts/reviews"
import { useConnectionHealth } from "@/lib/queries/use-connection-health"
import { cn } from "@/lib/utils"

type Review = ReviewDetail["review"]

type Exception = {
  title: string
  description: string
  tone: "caution" | "attention"
}

/**
 * The exceptions this pane is entitled to raise, and the evidence each one
 * needs.
 *
 * Every branch below is backed by a field the application actually holds. Two
 * that the design asked for are deliberately absent, because the payload cannot
 * support them honestly:
 *
 *  · "Reply changed after approval" needs the approval's draft binding
 *    (`review_reply.pending_draft_id`), which the detail response does not
 *    project. Inferring it from "the text looks different" would raise a
 *    governance warning off a guess.
 *  · Per-location connection state does not exist on the wire. The one real
 *    signal is the organisation-wide connection health, so the copy says
 *    "workspace" rather than claiming something about this venue.
 */
function describeException(
  review: Review,
  action: PrimaryAction,
  connection: string
): Exception | null {
  const reply = review.reply
  const verdict = review.latestVerification?.verdict

  if (review.workflowStatus === "failed" || reply?.publishStatus === "failed") {
    return {
      title: "Publish failed",
      description: reply?.googlePolicyViolation
        ? `Google flagged this reply: ${reply.googlePolicyViolation}`
        : "Google did not accept the last attempt. Edit the reply, then try again.",
      tone: "attention",
    }
  }

  if (reply?.publishStatus === "rejected") {
    return {
      title: "Google declined this reply",
      description: review.reply?.googlePolicyViolation
        ? `Google flagged this reply: ${review.reply.googlePolicyViolation}`
        : "Google's moderation declined the reply content. Edit the draft and publish again.",
      tone: "attention",
    }
  }

  if (connection === "disconnected") {
    return {
      title: "Google disconnected",
      description:
        "This workspace has no active Google connection, so replies cannot reach Google until it is reconnected in Settings.",
      tone: "attention",
    }
  }

  if (verdict === "fail") {
    return {
      title: "Correct the saved draft",
      description:
        "Verification blocked this reply. Fix the points listed under the draft, then save it again.",
      tone: "attention",
    }
  }

  if (review.workflowStatus === "awaiting_approval") {
    return review.capabilities.canPublish
      ? {
          title: "Approval required",
          // Deliberately not "YOUR approval is required". `canPublish` is a
          // location grant, and it stays true for the very person who
          // submitted the reply — only the server knows whether an
          // organisation's two-person rule will accept a decision from them.
          // The pane offers the action its capabilities permit and says what
          // the rule is, rather than asserting an ownership it cannot verify.
          description:
            "This reply is parked for approval. Read it, then approve it or send it back with Reject reply — an organisation that asks for two approvers will not take the decision from whoever submitted it.",
          tone: "caution",
        }
      : {
          title: "Waiting for another approver",
          description:
            "Someone with publishing rights needs to approve this reply. Editing and saving a new version returns it to Needs reply.",
          tone: "caution",
        }
  }

  if (action.kind === "submit") {
    return {
      title: "Approval required",
      description:
        "Your role can write and submit this reply. Someone with publishing rights handles the approval and the publish.",
      tone: "caution",
    }
  }

  if (
    !review.capabilities.canPublish &&
    !review.capabilities.canRequestApproval
  ) {
    return {
      title: "Publisher needed",
      description:
        "You can read and edit this reply, but publishing it for this location needs someone with publishing rights.",
      tone: "caution",
    }
  }

  if (verdict === "warn") {
    return {
      title: "Worth a second look",
      description:
        "Verification raised a point about this reply. Read the notes under the draft — you can still publish.",
      tone: "caution",
    }
  }

  return null
}

const STEP_STATE_INK: Record<LifecycleStep["state"], string> = {
  done: "text-ink-muted",
  current: "text-ink",
  todo: "text-ink-muted",
  skipped: "text-ink-muted",
  failed: "text-danger-ink",
}

/**
 * The exception, next to the reply decision it affects — and the detailed
 * lifecycle behind a disclosure underneath it.
 *
 * The five-stage tracker used to sit permanently across the top of every
 * review, including the eight-out-of-ten where nothing had gone wrong and the
 * whole pipeline said "done, done, done, not required, not published". It is
 * the same information, offered where it is actually wanted: when something is
 * in the way and the operator needs to know which step.
 */
function ReplyException({
  review,
  action,
}: {
  review: Review
  action: PrimaryAction
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const health = useConnectionHealth()
  const exception = describeException(review, action, health.status)
  if (!exception) return null

  const steps = deriveLifecycle(review)

  return (
    <aside
      data-slot="reply-exception"
      data-tone={exception.tone}
      aria-label="This reply needs attention"
      className={cn(
        "mt-4 flex flex-col gap-1 rounded-(--np-radius-control) border bg-fill-tertiary p-3",
        exception.tone === "attention"
          ? "border-(--np-danger-line)"
          : "border-(--np-warning-line)"
      )}
    >
      <strong className="text-ui font-semibold text-ink">
        {exception.title}
      </strong>
      <p className="text-ui leading-normal text-ink-muted">
        {exception.description}
      </p>

      <div className="mt-2 border-t border-line-subtle pt-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-8 w-full items-center justify-between gap-2 rounded-(--np-radius-tag) text-caption font-medium text-ink focus-halo focus-visible:outline-none"
        >
          <span>Workflow details</span>
          <ChevronDownIcon
            aria-hidden
            strokeWidth={1.75}
            className={cn(
              "size-3.5 text-ink-muted transition-transform duration-(--np-duration-fast) ease-spring-snappy",
              open && "rotate-180"
            )}
          />
        </button>
        {/* Permanently mounted so aria-controls never points at nothing. */}
        <ol
          id={panelId}
          hidden={!open}
          aria-label="Reply lifecycle details"
          className="flex flex-col gap-2 pt-2 pb-1"
        >
          {steps.map((step) => (
            <li
              key={step.id}
              data-state={step.state}
              aria-current={step.state === "current" ? "step" : undefined}
              className="flex items-baseline justify-between gap-3 text-caption"
            >
              <span
                className={cn(
                  step.state === "current"
                    ? "font-semibold text-ink"
                    : "text-ink"
                )}
              >
                {step.label}
              </span>
              <span className={cn("text-right", STEP_STATE_INK[step.state])}>
                {step.meta ??
                  (step.state === "done"
                    ? "Done"
                    : step.state === "skipped"
                      ? "Not required"
                      : "Waiting")}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  )
}

export { ReplyException, describeException }
