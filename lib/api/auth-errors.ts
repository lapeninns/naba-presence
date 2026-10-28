import { ApiClientError } from "./client"

export type AuthMessage = {
  title: string
  description?: string
  action?: "resend-confirmation" | "request-reset-link"
}

/**
 * Where the message appears. Auth pages are pre-session, so the workspace
 * mode (business or agency) is not known here and the copy stays neutral.
 */
export type AuthSurface =
  | "sign-in"
  | "create-account"
  | "forgot-password"
  | "reset-password"
  | "invitation"
  | "mfa"

// The outage codes name the thing the person was trying to do, so the title
// follows the surface. The explanation is the same everywhere.
const UNAVAILABLE_TITLE: Record<AuthSurface, string> = {
  "sign-in": "Sign-in is temporarily unavailable.",
  "create-account": "Account creation is temporarily unavailable.",
  "forgot-password": "Password reset is temporarily unavailable.",
  "reset-password": "Password reset is temporarily unavailable.",
  invitation: "Accepting invitations is temporarily unavailable.",
  mfa: "Two-step verification is temporarily unavailable.",
}

const SURFACE_AWARE_CODES = new Set([
  "password_auth_disabled",
  "auth_provider_unavailable",
])

const GENERIC: AuthMessage = {
  title: "Something went wrong.",
  description: "Try again in a moment.",
}

// The connection dropped or the request got no answer: a write comes back
// as `network_error` (lib/api/client.ts), a read as fetch's own TypeError.
// Nothing was refused, so say what to check rather than "something".
// fetch()'s own rejection in Chromium, WebKit and Firefox; any other
// TypeError is a bug, not the connection.
const FETCH_FAILED = /failed to fetch|load failed|networkerror/i
const NETWORK: AuthMessage = {
  title: "We couldn’t reach NabaPresence.",
  description: "Check your connection and try again.",
}

const BY_CODE: Record<string, AuthMessage> = {
  registration_closed: {
    title: "Access is by invitation during the pilot.",
    description:
      "Open your invitation link to create an account, or sign in to your existing account.",
  },
  invalid_credentials: {
    title: "That email or password is incorrect.",
    description: "Check both and try again.",
  },
  email_not_verified: {
    title: "Confirm your email address to continue.",
    description:
      "We sent a confirmation link when the account was created. Open it, then sign in.",
    action: "resend-confirmation",
  },
  auth_rate_limited: {
    title: "Too many attempts.",
    description: "Wait a while, then try again.",
  },
  password_auth_disabled: {
    title: "Sign-in is temporarily unavailable.",
    description: "This is a problem on our side. Try again shortly.",
  },
  auth_provider_unavailable: {
    title: "Sign-in is temporarily unavailable.",
    description: "This is a problem on our side. Try again shortly.",
  },
  verified_email_required: {
    title: "Your account needs a confirmed email address.",
    description: "Confirm the address you signed up with, then try again.",
  },
  invalid_email_link: {
    title: "That link is invalid or has expired.",
    description: "Request a fresh one and try again.",
    action: "request-reset-link",
  },
  // The reset route verified (spent) the link, then could not confirm the
  // new password was stored. Retrying the link can only fail, so point at
  // the one thing that may already work.
  password_reset_outcome_unknown: {
    title: "We couldn’t confirm your new password was saved.",
    description:
      "Try signing in with the new password. If that doesn’t work, request another link.",
    action: "request-reset-link",
  },
  password_reset_failed: {
    title: "That reset link is no longer valid.",
    description: "Request a fresh one and try again.",
    action: "request-reset-link",
  },
  invitation_expired: {
    title: "That invitation has expired.",
    description: "Ask an organisation owner or admin to send a new one.",
  },
  invitation_not_found: {
    title: "We could not find that invitation.",
    description: "Check the link, or ask for a new invitation.",
  },
  invitation_already_used: {
    title: "This invitation has already been accepted.",
    description: "Sign in to continue.",
  },
  invitation_changed: {
    title: "This invitation changed while you were looking at it.",
    description: "Reload the page to see the current invitation.",
  },
  invitation_email_mismatch: {
    title: "This invitation is for a different email address.",
    description: "Sign in with the address that received it.",
  },
  member_limit_reached: {
    title: "This workspace has no room for another member.",
    description:
      "Its plan's member limit is reached. Ask an owner to free a seat or change plan, then open the invitation again.",
  },
  invitation_scope_empty: {
    title: "This invitation no longer gives access to anything.",
    description:
      "The clients it was for have no listings now. Ask an owner or admin for a new invitation.",
  },
  support_session_forbidden: {
    title: "A support session cannot accept invitations.",
  },
  auth_identity_conflict: {
    title: "That email is already linked to another account.",
    description: "Sign in with the original account, or use a different email.",
  },
  invalid_request: {
    title: "Check the highlighted fields.",
  },
  mfa_code_invalid: {
    title: "That code did not match.",
    description:
      "Check your authenticator app and enter the code it shows now.",
  },
  mfa_ticket_invalid: {
    title: "Your sign-in has expired.",
    description: "Sign in again to get a new code request.",
  },
  mfa_factor_unknown: {
    title: "Choose one of your authenticator apps.",
  },
  mfa_required: {
    title: "This account uses two-step verification.",
    description: "Sign in with your email and password to enter your code.",
  },
  mfa_code_required: {
    title: "Enter a code from your current authenticator app.",
    description: "Adding a backup needs a code from the app you already use.",
  },
  mfa_factor_limit: {
    title: "You already have two authenticator apps.",
    description: "That is the most an account can have.",
  },
  mfa_disabled: {
    title: "Two-step verification is not available.",
  },
  mfa_assurance_unconfirmed: {
    title: "We could not confirm your code.",
    description: "This is a problem on our side. Try again shortly.",
  },
  // The account menu lands here after DELETE /api/session?scope=all signed
  // this browser out but could not end the other sessions.
  sign_out_everywhere_failed: {
    title: "You’re signed out on this device.",
    description:
      "Signing out everywhere didn’t finish, so other devices may still be signed in. Sign in, then choose Sign out everywhere again.",
  },
}

function messageForCode(
  code: string,
  surface: AuthSurface
): AuthMessage | undefined {
  const message = BY_CODE[code]
  if (message && SURFACE_AWARE_CODES.has(code)) {
    return { ...message, title: UNAVAILABLE_TITLE[surface] }
  }
  return message
}

/**
 * The wait a 429 already states (`details.retryAfter`, in seconds, the same
 * figure as its `retry-after` header), in words. The budgets count by IP and
 * by address whether or not an account exists, so naming the wait reveals
 * nothing the header doesn't.
 */
export function retryAfterWords(error: unknown): string | null {
  if (!(error instanceof ApiClientError)) return null
  const seconds = Reflect.get(Object(error.details), "retryAfter")
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0)
    return null
  const minutes = Math.ceil(seconds / 60)
  return minutes <= 1 ? "a minute" : `about ${minutes} minutes`
}

export function authErrorMessage(
  error: unknown,
  surface: AuthSurface
): AuthMessage {
  if (error instanceof ApiClientError) {
    if (error.code === "network_error") return NETWORK
    const wait =
      error.code === "auth_rate_limited" ? retryAfterWords(error) : null
    if (wait)
      return {
        ...BY_CODE.auth_rate_limited,
        description: `Try again in ${wait}.`,
      }
    const known = messageForCode(error.code, surface)
    if (known) return known
    // An unnamed server failure is ours, not the person's: the same words
    // as an outage, titled for what they were doing.
    if (error.status >= 500)
      return {
        ...BY_CODE.auth_provider_unavailable,
        title: UNAVAILABLE_TITLE[surface],
      }
    return GENERIC
  }
  if (error instanceof TypeError && FETCH_FAILED.test(error.message))
    return NETWORK
  return GENERIC
}

/**
 * Statuses `/auth/confirm` hands back (it alone adds `email=error`): the
 * person was opening a link from an email. A failed POST is always the
 * confirmation link; a malformed GET may also be a reset link, so the
 * words name both ways on, with the confirmation one as the action.
 */
const FROM_EMAIL_LINK: Record<string, AuthMessage> = {
  invalid_email_link: {
    title: "That email link has expired or was already used.",
    description:
      "Already confirmed your address? Sign in below. For a new confirmation link, enter your email and send one; for a new password reset link, choose Forgot password. Invited to a team? Open the invitation email again.",
    action: "resend-confirmation",
  },
  auth_rate_limited: {
    title: "Too many attempts.",
    description:
      "Wait a few minutes, then open the link from your email again.",
  },
  invitation_changed: {
    title: "This invitation changed after it was sent.",
    description:
      "Open the invitation email again to see the current invitation.",
  },
}

export function confirmStatusMessage(
  status: string,
  surface: AuthSurface = "sign-in",
  from?: "email-link"
): AuthMessage {
  if (from === "email-link") {
    const own =
      FROM_EMAIL_LINK[status] ??
      (BY_CODE[status] ? undefined : FROM_EMAIL_LINK.invalid_email_link)
    if (own) return own
  }
  return messageForCode(status, surface) ?? BY_CODE.invalid_email_link
}

export function fieldErrorsFrom(error: unknown): Record<string, string> {
  if (!(error instanceof ApiClientError) || error.code !== "invalid_request") {
    return {}
  }
  const issues = error.details
  if (!Array.isArray(issues)) return {}
  const fields: Record<string, string> = {}
  for (const issue of issues) {
    const path = (issue as { path?: unknown[] }).path
    const message = (issue as { message?: unknown }).message
    const key = Array.isArray(path) ? String(path[0] ?? "") : ""
    if (key && typeof message === "string" && !(key in fields)) {
      fields[key] = message
    }
  }
  return fields
}
