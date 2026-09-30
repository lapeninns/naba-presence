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
  "publication_failed",
  "publication_unresolved",
  "schedule_missed",
  "schedule_blocked",
  "bulk_completed_with_failures",
  "verification_changed",
  "suggestions_available",
  "resource_stale",
] as const
export type NotificationEventKind = (typeof NOTIFICATION_EVENT_KINDS)[number]

export const NOTIFICATION_CHANNELS = ["in_app", "email"] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]
export type NotificationMode = "immediate" | "digest" | "off"

/** Account-level conditions concern connected logins; only owners and admins see them. */
export const ACCOUNT_SCOPED_KINDS: readonly NotificationEventKind[] = [
  "connection_reconnect",
  "connection_owner_left",
]

/** Resolved by the condition clearing on re-evaluation, never by a person. */
export const CONDITION_KINDS: readonly NotificationEventKind[] = [
  "connection_reconnect",
  "listing_access_lost",
  "connection_owner_left",
  "listing_stale",
]

const MANAGER_IMMEDIATE: readonly NotificationEventKind[] = [
  "connection_reconnect",
  "listing_access_lost",
  "connection_owner_left",
  "listing_stale",
  "low_rating_review",
  "publication_failed",
  "schedule_missed",
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
    description: "A review of three stars or fewer arrived.",
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

export function isNotificationEventKind(
  value: string
): value is NotificationEventKind {
  return (NOTIFICATION_EVENT_KINDS as readonly string[]).includes(value)
}
