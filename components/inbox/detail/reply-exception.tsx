"use client"

import { CircleAlertIcon, TriangleAlertIcon } from "lucide-react"
import Link from "next/link"

import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { publishFailureCause } from "@/lib/inbox/publish-failure"
import type { PrimaryAction } from "@/lib/inbox/reply-state"
import type { ReviewDetail } from "@/lib/contracts/reviews"
import { useConnectionHealth } from "@/lib/queries/use-connection-health"
import { useSessionRole } from "@/lib/queries/use-session"
import { settingsGatingFromRole } from "@/lib/settings/gating"
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
  connection: string,
  /**
   * Owners and admins, the only roles `/settings/connections` opens for. Anyone
   * else keeps the explanation and is told who to ask, with no link that would
   * land on Access denied.
   */
  canManageConnections = true
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
        description: canManageConnections
          ? "The Google connection for this listing stopped working, so the reply never reached Google. Reconnect it, then retry — the reply itself does not need to change."
          : "The Google connection for this listing stopped working, so the reply never reached Google. Ask an owner or admin to reconnect Google, then retry — the reply itself does not need to change.",
        tone: "attention",
        connectionLink: canManageConnections,
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

  // Accepted by Google but held for moderation: not public yet, and nothing
  // for the operator to redo unless Google later rejects it.
  if (reply?.googleReplyState === "PENDING") {
    return {
      title: "Google is reviewing this reply",
      description:
        "The reply reached Google and is waiting for Google’s moderation. Customers don’t see it until Google approves it; this updates after the next sync.",
      tone: "caution",
    }
  }

  if (connection === "disconnected") {
    return {
      title: "Google disconnected",
      description: canManageConnections
        ? "This workspace has no active Google connection, so replies cannot reach Google until it is reconnected in Settings."
        : "This workspace has no active Google connection, so replies cannot reach Google. Ask an owner or admin to reconnect Google.",
      tone: "attention",
      connectionLink: canManageConnections,
    }
  }

  if (review.workflowStatus === "awaiting_approval") {
    // The server's answer when it sent one (plan D1): the same rule as the
    // Inbox's "awaiting my approval" queue, so it knows what `canPublish`
    // cannot — whether the two-person rule accepts a decision from this person.
    const serverScope = review.capabilities.approvalScope
    if (serverScope === "me") {
      return {
        title: "Approval required",
        description:
          "This reply is waiting for your approval. Approve it to send it to Google, or send it back for changes.",
        tone: "caution",
      }
    }
    if (serverScope === "others") {
      return {
        title: "Waiting for another approver",
        description:
          review.capabilities.requireTwoPersonApproval &&
          review.capabilities.canPublish
            ? "Your organisation needs a second person to approve each reply, so someone else with publishing rights must approve this one. Editing and saving a new version returns it to Needs reply."
            : "Someone with publishing rights needs to approve this reply. Editing and saving a new version returns it to Needs reply.",
        tone: "caution",
      }
    }
    return review.capabilities.canPublish
      ? {
          title: "Approval required",
          // Deliberately not "YOUR approval is required". `canPublish` is a
          // location grant, and it stays true for the very person who
          // submitted the reply — only the server knows whether an
          // organisation's two-person rule will accept a decision from them.
          // The pane offers the action its capabilities permit and keeps to
          // "waiting for approval", rather than asserting an ownership it
          // cannot verify.
          description:
            "This reply is waiting for approval. Someone with publishing rights can approve it or send it back for changes.",
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
      description: review.capabilities.canPublish
        ? // A publisher submits only under the two-person rule.
          "Your organisation needs a second person to approve each reply. Submit it, and another person with publishing rights approves it before it goes to Google."
        : "Your role can write and submit this reply. Someone with publishing rights handles the approval and the publish.",
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
  const canManageConnections =
    settingsGatingFromRole(useSessionRole()).canManageConnections
  const exception = describeException(
    review,
    action,
    health.status,
    canManageConnections
  )
  if (!exception) return null
  const Icon =
    exception.tone === "attention" ? CircleAlertIcon : TriangleAlertIcon
  // The glyph and the title take the tone's ink on its tint: the words say
  // what is wrong, and the colour only reinforces them.
  const toneInk =
    exception.tone === "attention" ? "text-danger-ink" : "text-warning-ink"
  const connectionLink = exception.connectionLink === true

  return (
    // The shared Alert on its tone's tint (the glyph in the tone's ink).
    // Not a live region (`live={false}`); the explicit role keeps it the
    // named complementary block it has always been.
    <Alert
      variant={exception.tone === "attention" ? "destructive" : "warning"}
      live={false}
      role="complementary"
      icon={<Icon aria-hidden strokeWidth={1.75} />}
      data-slot="reply-exception"
      data-tone={exception.tone}
      aria-label="This reply needs attention"
    >
      <AlertTitle className={cn("text-ui", toneInk)}>
        {exception.title}
      </AlertTitle>
      <AlertDescription className="text-ink-secondary">
        {exception.description}
        {exception.title === "Publish failed" ||
        exception.title === "Google declined this reply"
          ? " Nothing new is live on Google."
          : ""}
      </AlertDescription>
      {connectionLink ? (
        <AlertActions>
          <Link
            href="/settings/connections"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            Check Google connections
          </Link>
        </AlertActions>
      ) : null}
    </Alert>
  )
}

export { ReplyException, describeException }
