/**
 * Which operational notifications a person receives, and how. Client-safe.
 *
 * Only explicit choices are stored (notification_preference). Everything
 * else falls back to these defaults, which keep the email behaviour that
 * existed before preferences: owners and admins are emailed at once about
 * the original five conditions. The brief's urgent events (terminal
 * publication failure, missed schedules) join them. Every other email
 * category is opt-in, and members who are not owners or admins receive
 * email only after choosing it. In-app notifications default on.
 */

export const NOTIFICATION_EVENT_KINDS = [
  "connection_reconnect",
  "listing_access_lost",
  "connection_owner_left",
  "listing_stale",
  "low_rating_review",
  "approval_requested",
  "reply_sent_back",
  "publication_failed",
  "publication_unresolved",
  "mutation_unconfirmed",
  "schedule_missed",
  "schedule_blocked",
  "bulk_completed_with_failures",
  "verification_changed",
  "suggestions_available",
  "resource_stale",
  "ai_credits_low",
  "ai_credits_exhausted",
  // S3: a venue's topic turned sharply negative (review-topics-alerts.ts).
  "review_topic_negative",
  // S5: a protected listing field changed on Google (0155).
  "listing_google_changed",
] as const
export type NotificationEventKind = (typeof NOTIFICATION_EVENT_KINDS)[number]

export const NOTIFICATION_CHANNELS = ["in_app", "email"] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]
export type NotificationMode = "immediate" | "digest" | "off"

/**
 * Account-level conditions concern connected logins and the organisation's
 * AI credit allowance; only owners and admins see them.
 */
export const ACCOUNT_SCOPED_KINDS: readonly NotificationEventKind[] = [
  "connection_reconnect",
  "connection_owner_left",
  "ai_credits_low",
  "ai_credits_exhausted",
]

/**
 * Addressed to named people (notification_incident_recipient, 0149) rather
 * than to everyone who can see the location: a reply waiting for approval
 * goes to the people who could approve it, and a reply sent back goes to the
 * person who asked. An addressed incident with no recipient row reaches
 * nobody, owners and admins included.
 */
export const ADDRESSED_KINDS: readonly NotificationEventKind[] = [
  "approval_requested",
  "reply_sent_back",
  // S5: addressed to the listing's watch recipients (its owners and admins,
  // everyone who can see it, or the people chosen in its settings).
  "listing_google_changed",
]

/**
 * Resolved by the condition clearing on re-evaluation, never by a person.
 * The approval kinds clear when the reply moves on: a request once it is
 * decided, a send-back once the reply is submitted again, published or
 * marked as needing nothing.
 */
export const CONDITION_KINDS: readonly NotificationEventKind[] = [
  "connection_reconnect",
  "listing_access_lost",
  "connection_owner_left",
  "listing_stale",
  "ai_credits_low",
  "ai_credits_exhausted",
  "approval_requested",
  "reply_sent_back",
  // S3
  "review_topic_negative",
  // S5: cleared when someone puts ours back or keeps Google's, or Google
  // shows ours again; never by a "Resolve" in the inbox.
  "listing_google_changed",
]

const MANAGER_IMMEDIATE: readonly NotificationEventKind[] = [
  "connection_reconnect",
  "listing_access_lost",
  "connection_owner_left",
  "listing_stale",
  "low_rating_review",
  "publication_failed",
  // Listing-write recovery gave up (lib/server/mutation-recovery.ts): the
  // owners and admins it always reached are still emailed at once.
  "mutation_unconfirmed",
  "schedule_missed",
  "ai_credits_low",
  "ai_credits_exhausted",
  // S3: rare by design (one per venue and topic while it holds).
  "review_topic_negative",
  // S5: a wrong phone number or opening hours on Google costs covers today.
  "listing_google_changed",
]

export const NOTIFICATION_EVENT_LABELS: Record<
  NotificationEventKind,
  { label: string; description: string }
> = {
  connection_reconnect: {
    label: "Google login needs reconnecting",
    description: "Google stopped accepting a connected login.",
  },
  listing_access_lost: {
    label: "Listing access lost",
    description: "The connected login can no longer manage a listing.",
  },
  connection_owner_left: {
    label: "Connection owner left",
    description:
      "The person who connected a Google login left the organisation.",
  },
  listing_stale: {
    label: "Listing data delayed",
    description:
      "A listing has not synced successfully for longer than expected.",
  },
  low_rating_review: {
    label: "New low-rated review",
    description:
      "A review of three stars or fewer arrived, or a review was changed to three stars or fewer.",
  },
  approval_requested: {
    label: "Approval requested",
    description: "Someone submitted a reply to a review for your approval.",
  },
  reply_sent_back: {
    label: "Reply sent back",
    description:
      "An approver sent your reply back. Revise it and submit it again.",
  },
  publication_failed: {
    label: "Publishing failed",
    description: "Google rejected a change, or it could not be sent.",
  },
  publication_unresolved: {
    label: "Publishing outcome unresolved",
    description:
      "A change was sent but its Google result is not yet confirmed.",
  },
  mutation_unconfirmed: {
    label: "Change not confirmed on Google",
    description:
      "A sent listing change could not be confirmed by reading Google back.",
  },
  schedule_missed: {
    label: "Scheduled post missed",
    description: "A scheduled publication did not run in time.",
  },
  schedule_blocked: {
    label: "Scheduled post blocked",
    description: "A scheduled publication needs attention before it can run.",
  },
  bulk_completed_with_failures: {
    label: "Bulk change had failures",
    description: "A multi-location change finished with some locations failed.",
  },
  verification_changed: {
    label: "Verification changed",
    description: "A listing's Google verification state changed.",
  },
  suggestions_available: {
    label: "Google suggestions",
    description: "Google suggested changes to a listing.",
  },
  resource_stale: {
    label: "Profile data stale",
    description: "Part of a listing has not refreshed from Google recently.",
  },
  ai_credits_low: {
    label: "AI reply credits running low",
    description: "80% of this month's AI reply credits have been used.",
  },
  ai_credits_exhausted: {
    label: "AI reply credits used up",
    description: "All of this month's AI reply credits have been used.",
  },
  // S3
  review_topic_negative: {
    label: "Topic turning negative",
    description:
      "Reviews of a listing have been much more negative than usual about one topic over the last 14 days.",
  },
  // S5
  listing_google_changed: {
    label: "Listing changed on Google",
    description:
      "Google now shows a different value for a field you protect on a listing you can see, such as its hours or phone.",
  },
}

export function defaultNotificationMode(
  kind: NotificationEventKind,
  channel: NotificationChannel,
  role: "owner" | "admin" | "member" | "viewer"
): NotificationMode {
  if (channel === "in_app") return "immediate"
  const manager = role === "owner" || role === "admin"
  return manager && MANAGER_IMMEDIATE.includes(kind) ? "immediate" : "off"
}

export function isAddressedKind(kind: string): boolean {
  return (ADDRESSED_KINDS as readonly string[]).includes(kind)
}

export function isNotificationEventKind(
  value: string
): value is NotificationEventKind {
  return (NOTIFICATION_EVENT_KINDS as readonly string[]).includes(value)
}
