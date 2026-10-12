import type { InvitationDelivery } from "@/lib/contracts/invitations"

/**
 * What Team says about an invitation email (plan P06-6): a short state for
 * the pill and one sentence on what to do. Every state that is not "sent"
 * points at the link, which always works whatever happened to the email.
 *
 * Only `sent` claims the email went out, and only as "the provider accepted
 * it": nothing here can see the invitee's inbox.
 */
export type DeliveryPresentation = {
  tone: "ok" | "warn" | "bad" | "info" | "neutral" | "outline"
  label: string
  detail: string
  /** A dashed pill: not settled yet. */
  dashed?: boolean
}

const NOT_SET_UP = new Set([
  "provider_not_configured",
  "tenant_email_disabled",
  "app_url_not_configured",
])

function suppressed(errorCode: string | null): DeliveryPresentation {
  if (errorCode && NOT_SET_UP.has(errorCode)) {
    return {
      tone: "neutral",
      label: "Not sent",
      detail:
        "Email isn’t set up for this workspace yet. Copy the link and send it yourself.",
    }
  }
  if (errorCode === "invitation_email_rate_limited") {
    return {
      tone: "warn",
      label: "Not sent",
      detail:
        "Too many invitation emails in a short time. Copy the link, or resend later.",
    }
  }
  if (errorCode === "invitation_expired") {
    return {
      tone: "neutral",
      label: "Not sent",
      detail: "The invitation expired before the email went out.",
    }
  }
  if (errorCode === "invitation_accepted") {
    return {
      tone: "neutral",
      label: "Not sent",
      detail: "They accepted before the email went out.",
    }
  }
  return {
    tone: "neutral",
    label: "Not sent",
    detail: "The email wasn’t sent. Copy the link and send it yourself.",
  }
}

export function describeInvitationDelivery(
  delivery: InvitationDelivery | null | undefined,
  formatDay: (iso: string) => string
): DeliveryPresentation {
  if (!delivery) {
    return {
      tone: "outline",
      label: "Not emailed",
      detail:
        "Created as a link to share. Resend to email it, or copy the link.",
    }
  }
  switch (delivery.status) {
    case "pending":
      return {
        tone: "info",
        label: "Sending",
        dashed: true,
        detail:
          delivery.attempts > 1 || delivery.errorCode
            ? "The email provider didn’t take it yet. We’ll keep trying; the link works meanwhile."
            : "Queued to send. The link works meanwhile.",
      }
    case "sent":
      return {
        tone: "ok",
        label: "Email sent",
        detail: delivery.sentAt
          ? `Sent ${formatDay(delivery.sentAt)}. If it hasn’t arrived, ask them to check spam, or copy the link.`
          : "If it hasn’t arrived, ask them to check spam, or copy the link.",
      }
    case "failed":
      return {
        tone: "bad",
        label: "Email failed",
        detail:
          "The email provider refused it. Resend, or copy the link and send it yourself.",
      }
    case "uncertain":
      return {
        tone: "warn",
        label: "Not confirmed",
        detail:
          "We couldn’t confirm the email went out. Check with them before resending, or copy the link.",
      }
    case "suppressed":
      return suppressed(delivery.errorCode)
  }
}

/** Whether Resend is offered: not while a send is still queued or retrying. */
export function canResendInvitation(
  delivery: InvitationDelivery | null | undefined
): boolean {
  return delivery?.status !== "pending"
}
