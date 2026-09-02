import { apiFetch, type RequestOptions } from "./client"
import {
  registerResponseSchema,
  type RegisterInput,
  type ResendConfirmationInput,
  type ResetPasswordInput,
  type ResetRequestInput,
  type SignInInput,
} from "@/lib/contracts/auth"
import { invitationLookupSchema } from "@/lib/contracts/invitations"

export async function signIn(input: SignInInput): Promise<void> {
  await apiFetch("/api/auth/password/login", { method: "POST", body: input })
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

export async function completePasswordReset(input: ResetPasswordInput): Promise<void> {
  await apiFetch("/api/auth/password/reset/complete", {
    method: "POST",
    body: input,
  })
}

export async function resendConfirmation(email: string): Promise<void> {
  await apiFetch("/api/auth/password/resend", {
    method: "POST",
    body: { email } satisfies ResendConfirmationInput,
  })
}

export async function signOut(): Promise<void> {
  await apiFetch("/api/session", { method: "DELETE" })
}

export async function lookupInvitation(token: string, options?: RequestOptions) {
  return apiFetch(`/api/invitations/${encodeURIComponent(token)}`, {
    schema: invitationLookupSchema,
    ...options,
  })
}
