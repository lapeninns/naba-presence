import { ApiClientError } from "./client"

export type AuthMessage = {
  title: string
  description?: string
  action?: "resend-confirmation" | "request-reset-link"
}

const GENERIC: AuthMessage = {
  title: "Something went wrong.",
  description: "Try again in a moment.",
}

const BY_CODE: Record<string, AuthMessage> = {
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
    description: "Wait a minute, then try again.",
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
    description: "Sign in to reach the agency.",
  },
  invitation_changed: {
    title: "This invitation changed while you were looking at it.",
    description: "Reload the page to see the current invitation.",
  },
  invitation_email_mismatch: {
    title: "This invitation is for a different email address.",
    description: "Sign in with the address that received it.",
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
}

export function authErrorMessage(error: unknown): AuthMessage {
  if (error instanceof ApiClientError) {
    return BY_CODE[error.code] ?? GENERIC
  }
  return GENERIC
}

export function confirmStatusMessage(status: string): AuthMessage {
  return BY_CODE[status] ?? BY_CODE.invalid_email_link
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
