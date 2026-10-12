/**
 * What each incident says in an email. Plain text, one link, and only the
 * display fields an incident stores (a login's email address, a listing
 * title, a star rating): never a token, a provider error body, a reviewer's
 * name or the text of their review.
 */

import { NOTIFICATION_EVENT_LABELS, isNotificationEventKind, type NotificationEventKind } from "@/lib/domain/notification-preferences"

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

export function renderIncidentEmail(
  kind: IncidentKind,
  summary: Record<string, unknown>,
  appUrl: string
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
          `Usage: ${link("/settings")}`,
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
          `Usage: ${link("/settings")}`,
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
  const where = typeof summary.locationId === "string" ? link(`/listings/${summary.locationId}`) : link("/listings")
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
  }
  return {
    subject: `${label}: ${title}`,
    text: [detail[kind] ?? NOTIFICATION_EVENT_LABELS[kind].description, `Open: ${where}`, "", FOOTER].join("\n"),
  }
}

/** A day's digest: one line per incident, no provider error bodies or personal data. */
export function renderDigestEmail(incidents: ReadonlyArray<{ kind: string; summary: Record<string, unknown> }>, appUrl: string) {
  const lines = incidents.map((incident) => {
    const label = isNotificationEventKind(incident.kind) ? NOTIFICATION_EVENT_LABELS[incident.kind].label : "Update"
    return `- ${label}: ${text(incident.summary.title, "a listing")}`
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
    | "google_quota_pressure",
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
