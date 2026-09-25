"use client"

import { CircleAlertIcon, TriangleAlertIcon } from "lucide-react"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { publishFailureCause } from "@/lib/inbox/publish-failure"
import type { PrimaryAction } from "@/lib/inbox/reply-state"
import type { ReviewDetail } from "@/lib/contracts/reviews"
import { useConnectionHealth } from "@/lib/queries/use-connection-health"
import { cn } from "@/lib/utils"

type Review = ReviewDetail["review"]

type Exception = {
  title: string
  description: string
  tone: "caution" | "attention"
  /**
   * Offer the way to Settings › Connections. Only when the cause is the
   * connection: sending someone to reconnect over a reply Google refused, or
   * over a timeout, sends them to fix the one thing that is not broken.
   */
  connectionLink?: boolean
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

  if (review.workflowStatus === "failed" || reply?.publishStatus === "failed") {
    const cause = publishFailureCause(reply)
    if (cause === "content") {
      return {
        title: "Publish failed",
        description: reply?.googlePolicyViolation
          ? `Google flagged this reply: ${reply.googlePolicyViolation}`
          : "Google refused the reply as written. Edit the reply, then publish again.",
        tone: "attention",
      }
    }
    if (cause === "connection") {
      return {
        title: "Publish failed",
        description:
          "The Google connection for this listing stopped working, so the reply never reached Google. Reconnect it, then retry — the reply itself does not need to change.",
        tone: "attention",
        connectionLink: true,
      }
    }
    if (cause === "transient") {
      return {
        title: "Publish failed",
        description:
          "Google did not answer in time. The reply is fine as it is — retry the publish.",
        tone: "attention",
      }
    }
    return {
      title: "Publish failed",
      description:
        "Google did not accept the last attempt. Retry the publish; if it fails again, edit the reply.",
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
      connectionLink: true,
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

  // An approver sent the reply back. The note they wrote in the reject dialog
  // is the whole point of rejecting rather than editing, so the author sees
  // it here until they resubmit.
  if (review.lastRejection) {
    const who = review.lastRejection.decidedByName ?? "An approver"
    const note = review.lastRejection.note?.trim()
    return {
      title: "Sent back by the approver",
      description: note
        ? `${who} rejected this reply: “${note}” Edit it, then submit it again.`
        : `${who} rejected this reply without a note. Edit it, then submit it again.`,
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
    !review.capabilities.canEdit &&
    !review.capabilities.canPublish &&
    !review.capabilities.canRequestApproval
  ) {
    return {
      title: "View-only access",
      description:
        "You can read this review and its reply, but not edit or publish it for this location. Ask an owner or admin for reply access.",
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

  return null
}

/**
 * The exception, at the head of the review it affects (reference `.alert`):
 * a tinted block with the glyph in the tone's ink, the title, what happened
 * in words, and — where the operator can do something outside this pane —
 * the link that does it. Where the reply has got to is the status line on
 * the publish bar, and a failed check is said under the editor, so this says
 * only what is in the way.
 *
 * Deliberately not `role="alert"`: the pane's one live status is the line
 * on the action bar, and a second announcement of the same fact on every
 * review opened would be noise.
 */
function ReplyException({
  review,
  action,
}: {
  review: Review
  action: PrimaryAction
}) {
  const health = useConnectionHealth()
  const exception = describeException(review, action, health.status)
  if (!exception) return null
  const Icon =
    exception.tone === "attention" ? CircleAlertIcon : TriangleAlertIcon
  const connectionLink = exception.connectionLink === true

  return (
    <aside
      data-slot="reply-exception"
      data-tone={exception.tone}
      aria-label="This reply needs attention"
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-(--np-radius-card) px-3.5 py-3 text-ui text-ink",
        exception.tone === "attention" ? "bg-danger-tint" : "bg-warning-tint"
      )}
    >
      <Icon
        aria-hidden
        strokeWidth={1.75}
        className={cn(
          "row-span-3 mt-0.5 size-4",
          exception.tone === "attention"
            ? "text-danger-ink"
            : "text-warning-ink"
        )}
      />
      <strong className="font-semibold">{exception.title}</strong>
      <p className="leading-normal text-ink-secondary">
        {exception.description}
        {exception.title === "Publish failed" ||
        exception.title === "Google declined this reply"
          ? " Nothing new is live on Google."
          : ""}
      </p>
      {connectionLink ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Link
            href="/settings/connections"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            Check Google connections
          </Link>
        </div>
      ) : null}
    </aside>
  )
}

export { ReplyException, describeException }
