/**
 * What each incident says in an email. Plain text, one link, and only the
 * display fields an incident stores (a login's email address, a listing
 * title, a star rating): never a token, a provider error body, a reviewer's
 * name or the text of their review.
 */

import { NOTIFICATION_EVENT_LABELS, isNotificationEventKind, type NotificationEventKind } from "@/lib/domain/notification-preferences"
import { SCHEDULE_REASON } from "@/lib/locations/schedule-display"
import { reviewNotificationPath } from "@/lib/notifications/links"

export type IncidentKind = NotificationEventKind

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

/** How an unconfirmed change is named, by operation surface. */
const SURFACE_LABEL: Record<string, string> = {
  hours: "An opening hours change",
  profile: "A profile change",
  food_menus: "A menu change",
  business_information: "A business information change",
  industry: "A change to industry details",
  local_post: "A post",
  place_action: "A booking or ordering link change",
  media: "A photo or video change",
}

const FOOTER =
  "You receive this because of your NabaPresence notification settings. Change them in Settings, Notifications."

/**
 * Where an email sends someone to see their AI reply credits. With billing
 * on they are on the shared Usage screen (/settings/usage); with it off that
 * page is not served and the credits card sits on Reply policy
 * (/settings/policy). Never bare /settings: on a phone that is the settings
 * index, not the credits.
 */
export function usageSettingsPath(billingEnabled: boolean): string {
  return billingEnabled ? "/settings/usage" : "/settings/policy"
}

export type IncidentEmailOptions = {
  /** The deployment's BILLING_ENABLED, which decides where Usage lives. */
  billingEnabled?: boolean
}

export function renderIncidentEmail(
  kind: IncidentKind,
  summary: Record<string, unknown>,
  appUrl: string,
  { billingEnabled = false }: IncidentEmailOptions = {}
): { subject: string; text: string } {
  const link = (path: string) => new URL(path, appUrl).toString()
  switch (kind) {
    case "connection_reconnect": {
      const login = text(summary.googleEmail, "A connected Google login")
      const permission =
        summary.reason === "insufficient_scope" ||
        summary.reason === "invalid_scope"
      return {
        subject: `Action needed: reconnect ${login}`,
        text: [
          permission
            ? `${login} is connected without permission to manage Business Profiles.`
            : `Google stopped accepting ${login}.`,
          "Reviews and profile changes for the listings it covers are paused until someone reconnects it.",
          `Reconnect: ${link("/settings/connections")}`,
          "",
          FOOTER,
        ].join("\n"),
      }
    }
    case "listing_access_lost": {
      const title = text(summary.title, "A listing")
      return {
        subject: `Action needed: NabaPresence can't reach ${title}`,
        text: [
          `The connected Google login no longer has manager access to ${title}.`,
          "Reconnecting will not fix this. Ask the business to add the login back as a manager of the Business Profile. The other listings keep syncing.",
          `Listings: ${link("/listings")}`,
          "",
          FOOTER,
        ].join("\n"),
      }
    }
    case "listing_stale": {
      const title = text(summary.title, "A listing")
      const hours =
        typeof summary.staleAfterHours === "number"
          ? summary.staleAfterHours
          : 6
      return {
        subject: `Data delayed: ${title} hasn't synced for ${hours}+ hours`,
        text: [
          `NabaPresence hasn't completed a successful check of ${title} with Google for more than ${hours} hours.`,
          "It keeps retrying on its own and nobody needs to reconnect anything. New reviews may appear late until it catches up.",
          `Listings: ${link("/listings")}`,
          "",
          FOOTER,
        ].join("\n"),
      }
    }
    case "low_rating_review": {
      const title = text(summary.title, "one of your listings")
      const rating = typeof summary.rating === "number" ? summary.rating : null
      return {
        subject: `New ${rating ? `${rating}-star ` : ""}review for ${title}`,
        text: [
          `${title} has a new ${rating ? `${rating}-star ` : ""}review on Google.`,
          `Read and reply: ${link("/inbox")}`,
          "",
          FOOTER,
        ].join("\n"),
      }
    }
    case "ai_credits_low": {
      const used = typeof summary.used === "number" ? summary.used : null
      const allowance =
        typeof summary.allowance === "number" ? summary.allowance : null
      const period = summary.period === "period" ? "period" : "month"
      const resets = text(summary.resetsOn, `the start of the next ${period}`)
      return {
        subject: `You have used 80% of this ${period}'s AI reply credits`,
        text: [
          used !== null && allowance !== null
            ? `${used} of ${allowance} AI reply credits have been used this ${period}.`
            : `80% of this ${period}'s AI reply credits have been used.`,
          `Credits reset on ${resets}. You can always write a reply yourself.`,
          `Usage: ${link(usageSettingsPath(billingEnabled))}`,
          "",
          FOOTER,
        ].join("\n"),
      }
    }
    case "ai_credits_exhausted": {
      const period = summary.period === "period" ? "period" : "month"
      const resets = text(summary.resetsOn, `the start of the next ${period}`)
      return {
        subject: `You are out of AI reply credits this ${period}`,
        text: [
          `All of this ${period}'s AI reply credits have been used. Credits reset on ${resets}.`,
          "Until then the Generate button is off, but you can still write and publish replies yourself.",
          `Usage: ${link(usageSettingsPath(billingEnabled))}`,
          "",
          FOOTER,
        ].join("\n"),
      }
    }
    case "mutation_unconfirmed": {
      const title = text(summary.title, "one of your listings")
      const what = SURFACE_LABEL[text(summary.surface, "")] ?? "A change"
      return {
        subject: `Check Google: a change to ${title} could not be confirmed`,
        text: [
          `${what} sent to Google for ${title} may or may not have been applied. Google did not confirm it, and NabaPresence could not find out by reading the listing back.`,
          "Nothing will be sent again automatically. Check the listing on Google, then make the change again in NabaPresence only if it is missing.",
          `Listings: ${link("/listings")}`,
          "",
          FOOTER,
        ].join("\n"),
      }
    }
    case "connection_owner_left": {
      const login = text(summary.googleEmail, "A connected Google login")
      return {
        subject: `The person who connected ${login} has left`,
        text: [
          `${login} was connected by someone who is no longer a member of your organisation.`,
          "It keeps working for now, but it runs on their Google access. Reconnect it with a Google account the business manages, so it keeps working if their access is removed.",
          `Connections: ${link("/settings/connections")}`,
          "",
          FOOTER,
        ].join("\n"),
      }
    }
    default:
      return renderOperationalEmail(kind, summary, link)
  }
}

/**
 * The operational events (WP8). Wording states what is known: a sent change
 * with no confirmed result is "unresolved", never "failed" or "done".
 */
function renderOperationalEmail(kind: NotificationEventKind, summary: Record<string, unknown>, link: (path: string) => string) {
  const title = text(summary.title, "A listing")
  const review = reviewNotificationPath(kind, summary)
  const where = review ? link(review)
    : typeof summary.locationId === "string" ? link(`/listings/${summary.locationId}`) : link("/listings")
  const label = NOTIFICATION_EVENT_LABELS[kind].label
  const detail: Partial<Record<NotificationEventKind, string>> = {
    publication_failed: `A change to ${title} was not published. Nothing further will be sent automatically.`,
    publication_unresolved: `A change to ${title} was sent, but Google's result is not confirmed yet. It will not be sent again automatically; check its saved outcome.`,
    schedule_missed: `A scheduled post for ${title} did not publish in time and will not publish late.`,
    schedule_blocked: `A scheduled post for ${title} cannot run until someone reviews it.`,
    bulk_completed_with_failures: "A multi-location change finished with some locations failed. Successful locations keep their changes.",
    verification_changed: `The Google verification state of ${title} changed.`,
    suggestions_available: `Google suggested changes to ${title}. Nothing is applied until you review it.`,
    resource_stale: `Part of ${title} has not refreshed from Google recently.`,
    approval_requested: `A reply to a review of ${title} is waiting for your approval. It is not sent to Google until someone approves it.`,
    reply_sent_back: `An approver sent back your reply to a review of ${title}. It was not sent to Google. Revise it and submit it again.`,
  }
  const why = scheduleReason(kind, summary)
  return {
    subject: `${label}: ${title}`,
    text: [detail[kind] ?? NOTIFICATION_EVENT_LABELS[kind].description, ...(why ? [why] : []), `Open: ${where}`, "", FOOTER].join("\n"),
  }
}

/**
 * A schedule's incident also says why it stopped, in the Posts tab's words
 * (P08-R6), in both the immediate email and the digest (schedule_blocked and
 * schedule_missed are digest by default). The reason is a stored code; an
 * unknown or inherited one adds nothing.
 */
function scheduleReason(kind: string, summary: Record<string, unknown>): string | undefined {
  return (kind === "schedule_missed" || kind === "schedule_blocked") &&
    typeof summary.reason === "string" &&
    Object.hasOwn(SCHEDULE_REASON, summary.reason)
    ? SCHEDULE_REASON[summary.reason]
    : undefined
}

/** A day's digest: one line per incident, no provider error bodies or personal data. */
export function renderDigestEmail(incidents: ReadonlyArray<{ kind: string; summary: Record<string, unknown> }>, appUrl: string) {
  const lines = incidents.map((incident) => {
    const label = isNotificationEventKind(incident.kind) ? NOTIFICATION_EVENT_LABELS[incident.kind].label : "Update"
    const why = scheduleReason(incident.kind, incident.summary)
    const line = `- ${label}: ${text(incident.summary.title, "a listing")}`
    return why ? `${line}\n  ${why}` : line
  })
  return {
    subject: `NabaPresence daily summary: ${incidents.length} ${incidents.length === 1 ? "update" : "updates"}`,
    text: ["Updates since your last summary:", ...lines, "", `Notifications: ${new URL("/notifications", appUrl).toString()}`, "", FOOTER].join("\n"),
  }
}

function lastFailure(details: Record<string, unknown>): string[] {
  return details.lastFailedAt
    ? [
        `Its last run failed at ${text(details.lastFailedAt, "an unknown time")} (${text(details.lastErrorCode, "unknown error")}).`,
      ]
    : []
}

/** Infrastructure alerts for operators. */
export function renderPlatformEmail(
  kind:
    | "stale_heartbeat"
    | "tick_never_completed"
    | "tick_lock_wedged"
    | "tick_cycle_overdue"
    | "tick_cycle_failures"
    | "google_quota_pressure"
    | "scheduled_post_stuck"
    | "scheduled_post_overdue"
    | "billing_event_dead"
    | "billing_sync_failing"
    | "billing_plan_unknown",
  subject: string,
  details: Record<string, unknown>
): { subject: string; text: string } {
  if (kind === "stale_heartbeat") {
    return {
      subject: `NabaPresence: the ${subject} tick has stopped`,
      text: [
        `The scheduled "${subject}" tick has not completed since ${text(details.lastCompletedAt, "an unknown time")}.`,
        `It is expected at least every ${details.staleAfterSeconds ?? "?"} seconds.`,
        ...lastFailure(details),
        'Check Vercel Cron and the function logs (docs/runbook.md, "Stale heartbeat").',
      ].join("\n"),
    }
  }
  if (kind === "tick_never_completed") {
    return {
      subject: `NabaPresence: the ${subject} tick has never completed`,
      text: [
        `The scheduled "${subject}" tick has not completed a run since it was registered at ${text(details.registeredAt, "an unknown time")}.`,
        `It is expected at least every ${details.staleAfterSeconds ?? "?"} seconds. Manual refreshes do not count.`,
        ...lastFailure(details),
        'Check that its cron is configured and the function logs (docs/runbook.md, "Stale heartbeat").',
      ].join("\n"),
    }
  }
  if (kind === "tick_lock_wedged") {
    return {
      subject: `NabaPresence: the ${subject} tick keeps skipping on its lock`,
      text: [
        `The last ${details.consecutiveSkips ?? "?"} scheduled "${subject}" runs found its advisory lock already held and did nothing.`,
        `The lock was last taken at ${text(details.lastStartedAt, "an unknown time")}.`,
        'Look for a long-running or stuck session holding it (docs/runbook.md, "Stale heartbeat").',
      ].join("\n"),
    }
  }
  if (kind === "tick_cycle_overdue") {
    return {
      subject: `NabaPresence: the ${subject} cycle is overdue`,
      text: [
        `The "${subject}" tick has not finished a full cycle since ${text(details.lastCycleCompletedAt ?? details.registeredAt, "an unknown time")}.`,
        `A cycle is expected at least every ${details.cycleStaleAfterSeconds ?? "?"} seconds.`,
        'Check the tick\'s failures and cursor in the function logs (docs/runbook.md, "Stale heartbeat").',
      ].join("\n"),
    }
  }
  if (kind === "tick_cycle_failures") {
    const organisations = Array.isArray(details.organisations)
      ? (details.organisations as Record<string, unknown>[])
      : []
    return {
      subject: `NabaPresence: the ${subject} cycle left organisations unretained`,
      text: [
        `The "${subject}" cycle for ${text(details.cycleDate, "an unknown day")} completed with ${details.failed ?? "?"} of ${details.enumerated ?? "?"} organisations failed after every attempt; their expired content has not been purged.`,
        ...(Number(details.repeated) > 0
          ? [`${details.repeated} of them also failed in the cycle before.`]
          : []),
        ...organisations.map(
          (organisation) =>
            `- ${text(organisation.organisationId, "unknown")}: ${text(organisation.lastErrorCode, "unknown error")} after ${organisation.attempts ?? "?"} runs`
        ),
        'Read the failures and retain them by hand (docs/runbook.md, "Retention cycle").',
      ].join("\n"),
    }
  }
  // P08-R6. The subject is an organisation id; nothing from a post is named.
  if (kind === "scheduled_post_stuck") {
    return {
      subject: "NabaPresence: a scheduled post is stuck publishing",
      text: [
        `Organisation ${subject} has ${details.occurrences ?? "?"} scheduled post publication(s) still marked publishing since ${text(details.oldestStartedAt, "an unknown time")}, past their lease.`,
        "The jobs tick has not reclaimed them. Once it runs they become unresolved and are checked against Google; none is sent again.",
        'Check the jobs tick and the scheduled_post pause (docs/runbook.md, "Scheduled post alerts").',
      ].join("\n"),
    }
  }
  if (kind === "scheduled_post_overdue") {
    return {
      subject: "NabaPresence: scheduled posts were not recorded as missed",
      text: [
        `Organisation ${subject} has ${details.occurrences ?? "?"} scheduled post publication(s) still waiting more than three minutes after their 5-minute window closed (oldest deadline ${text(details.oldestDeadlineAt, "unknown")}).`,
        "None of them will publish late, but the jobs tick's sweep has not recorded them as missed, so nobody has been told.",
        'Check the jobs tick and post_schedule.sweep_failed in the logs (docs/runbook.md, "Scheduled post alerts").',
      ].join("\n"),
    }
  }
  // R2B-06. The subject is an organisation id; nothing from Stripe is named.
  if (kind === "billing_event_dead") {
    return {
      subject: "NabaPresence: a billing event was dead-lettered",
      text: [
        `Organisation ${subject} has ${details.events ?? "?"} Stripe event(s) that failed every retry, the oldest at ${text(details.oldestDeadAt, "an unknown time")} (last error ${text(details.lastErrorCode, "unknown")}), and no sync has succeeded since.`,
        "Its billing record may not match Stripe; the hourly reconcile repairs it once the cause is fixed.",
        'Read billing.event_failed in the logs (docs/runbook.md, "Billing alerts").',
      ].join("\n"),
    }
  }
  if (kind === "billing_sync_failing") {
    return {
      subject: "NabaPresence: billing keeps failing to sync",
      text: [
        `The last ${details.failures ?? "?"} background billing syncs for organisation ${subject} failed, most recently at ${text(details.lastFailedAt, "an unknown time")} with ${text(details.lastErrorCode, "an unknown error")}.`,
        "Its billing record is not following Stripe, so its access may be wrong.",
        'Read billing.reconcile_failed and billing.event_failed in the logs (docs/runbook.md, "Billing alerts").',
      ].join("\n"),
    }
  }
  if (kind === "billing_plan_unknown") {
    return {
      subject: "NabaPresence: a subscribed price is missing from the billing catalog",
      text: [
        `Organisation ${subject} is subscribed to a Stripe price the plan catalog does not know (last failure ${text(details.lastFailedAt, "at an unknown time")}).`,
        "Every sync for it fails until the catalog has that price, and its access stays as it was: a pilot keeps full access.",
        'Add the price with scripts/billing-catalog.mjs (docs/runbook.md, "Billing alerts").',
      ].join("\n"),
    }
  }
  return {
    subject: `NabaPresence: Google is rate limiting ${subject}`,
    text: [
      `Google answered 429 for ${subject} in the last 15 minutes (${details.throttledCount ?? "?"} times in total).`,
      'Scheduled work is being deferred automatically. If it persists, check quota in the Cloud Console (docs/runbook.md, "Google quota").',
    ].join("\n"),
  }
}

const INVITE_ROLE_LABELS = {
  owner: "an owner",
  admin: "an admin",
  member: "a member",
  viewer: "a viewer",
} as const

/** One line of user-provided text, safe for a subject or a sentence. */
function oneLine(value: string, fallback: string, max = 120): string {
  const flat = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim()
  if (!flat) return fallback
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * An invitation (plan P06-6): the organisation, the role, the link and when
 * it stops working. The link carries the invitation token, so it is the one
 * secret this email holds: it goes in the body only, never in a subject or a
 * log line. The link is built by the caller from NEXTAUTH_URL.
 */
export function renderInvitationEmail(input: {
  organisationName: string
  role: keyof typeof INVITE_ROLE_LABELS
  inviteUrl: string
  expiresAt: Date
  timeZone?: string
}): { subject: string; text: string } {
  const organisation = oneLine(input.organisationName, "a NabaPresence workspace")
  const format = (timeZone: string) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone,
    }).format(input.expiresAt)
  let expires: string
  try {
    expires = format(input.timeZone ?? "Europe/London")
  } catch {
    // An organisation timezone Intl does not know: never fail the send on it.
    expires = format("Europe/London")
  }
  return {
    subject: `You're invited to join ${organisation} on NabaPresence`,
    text: [
      `You've been invited to join ${organisation} on NabaPresence as ${INVITE_ROLE_LABELS[input.role]}.`,
      "",
      `Accept the invitation: ${input.inviteUrl}`,
      "",
      `The link works once and expires on ${expires}. Sign in or create your account with this email address to accept it.`,
      "If you weren't expecting this, you can ignore this email; nothing happens unless you accept.",
    ].join("\n"),
  }
}
