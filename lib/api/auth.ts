import { ApiClientError, apiFetch, type RequestOptions } from "./client"
import {
  loginResponseSchema,
  registerResponseSchema,
  resetCompleteResponseSchema,
  type RegisterInput,
  type ResendConfirmationInput,
  type ResetPasswordInput,
  type ResetRequestInput,
  type SignInInput,
} from "@/lib/contracts/auth"
import {
  invitationAcceptedResponseSchema,
  invitationLookupSchema,
} from "@/lib/contracts/invitations"

/**
 * `mfaRequired`: the password was right but no session exists yet; the
 * caller sends the person to `/sign-in/verify` for their code.
 */
export async function signIn(
  input: SignInInput
): Promise<{ mfaRequired: boolean }> {
  const result = await apiFetch("/api/auth/password/login", {
    method: "POST",
    body: input,
    schema: loginResponseSchema,
  })
  return { mfaRequired: result.mfaRequired === true }
}

export async function register(
  input: RegisterInput
): Promise<{ authenticated: boolean; confirmationRequired: boolean }> {
  const result = await apiFetch("/api/auth/password/register", {
    method: "POST",
    body: input,
    schema: registerResponseSchema,
  })
  return {
    authenticated: result.authenticated,
    confirmationRequired: result.confirmationRequired ?? !result.authenticated,
  }
}

export async function requestPasswordReset(email: string): Promise<void> {
  await apiFetch("/api/auth/password/reset/request", {
    method: "POST",
    body: { email } satisfies ResetRequestInput,
  })
}

export async function completePasswordReset(
  input: ResetPasswordInput
): Promise<{ mfaRequired: boolean }> {
  const result = await apiFetch("/api/auth/password/reset/complete", {
    method: "POST",
    body: input,
    schema: resetCompleteResponseSchema,
  })
  return { mfaRequired: result.mfaRequired === true }
}

export async function resendConfirmation(
  email: string,
  inviteToken?: string
): Promise<void> {
  await apiFetch("/api/auth/password/resend", {
    method: "POST",
    body: { email, inviteToken } satisfies ResendConfirmationInput,
  })
}

/**
 * Resolves only when the server confirmed the sign-out. A 503
 * `sign_out_everywhere_failed` (see {@link signedOutHereOnly}) means this
 * browser is signed out but other sessions may not be; anything else thrown
 * means this browser may still be signed in.
 */
export async function signOut(
  options: { everywhere?: boolean } = {}
): Promise<void> {
  await apiFetch(
    options.everywhere ? "/api/session?scope=all" : "/api/session",
    {
      method: "DELETE",
    }
  )
}

/**
 * True when "sign out everywhere" ended this browser's session but could not
 * end the others: the caller must treat this browser as signed out without
 * claiming every device is.
 */
export function signedOutHereOnly(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.code === "sign_out_everywhere_failed"
  )
}

/**
 * Ends the support impersonation the current cookie carries: records
 * `support.impersonation.ended` and clears the session.
 */
export async function endImpersonation(): Promise<void> {
  await apiFetch("/api/support/impersonation", { method: "DELETE" })
}

/** Accepts an invitation with the session the visitor already holds. */
export async function acceptInvitation(token: string) {
  return apiFetch(`/api/invitations/${encodeURIComponent(token)}`, {
    method: "POST",
    schema: invitationAcceptedResponseSchema,
  })
}

export async function lookupInvitation(
  token: string,
  options?: RequestOptions
) {
  return apiFetch(`/api/invitations/${encodeURIComponent(token)}`, {
    schema: invitationLookupSchema,
    ...options,
  })
}
