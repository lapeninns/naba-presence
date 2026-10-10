/**
 * What each incident says in an email. Plain text, one link, and only the
 * display fields an incident stores (a login's email address, a listing
 * title, a star rating): never a token, a provider error body, a reviewer's
 * name or the text of their review.
 */

export type IncidentKind =
  | "connection_reconnect"
  | "listing_access_lost"
  | "listing_stale"
  | "low_rating_review"
  | "connection_owner_left"
  | "ai_credits_low"
  | "ai_credits_exhausted"
  | "mutation_unconfirmed"

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
  "You receive this because you are an owner or admin of this organisation in NabaPresence."

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
      const resets = text(summary.resetsOn, "the start of next month")
      return {
        subject: "You have used 80% of this month's AI reply credits",
        text: [
          used !== null && allowance !== null
            ? `${used} of ${allowance} AI reply credits have been used this month.`
            : "80% of this month's AI reply credits have been used.",
          `Credits reset on ${resets}. You can always write a reply yourself.`,
          `Usage: ${link("/settings")}`,
          "",
          FOOTER,
        ].join("\n"),
      }
    }
    case "ai_credits_exhausted": {
      const resets = text(summary.resetsOn, "the start of next month")
      return {
        subject: "You are out of AI reply credits this month",
        text: [
          `All of this month's AI reply credits have been used. Credits reset on ${resets}.`,
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
  return {
    subject: `NabaPresence: Google is rate limiting ${subject}`,
    text: [
      `Google answered 429 for ${subject} in the last 15 minutes (${details.throttledCount ?? "?"} times in total).`,
      'Scheduled work is being deferred automatically. If it persists, check quota in the Cloud Console (docs/runbook.md, "Google quota").',
    ].join("\n"),
  }
}
