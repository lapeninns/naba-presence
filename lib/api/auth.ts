import { z } from "zod"

import { apiFetch, type RequestOptions } from "./client"

const registerResponseSchema = z.object({
  authenticated: z.boolean(),
  confirmationRequired: z.boolean().optional(),
})

const invitationSchema = z.object({
  organisationName: z.string(),
  email: z.string(),
  accepted: z.boolean(),
  expired: z.boolean(),
})

export async function signIn(input: {
  email: string
  password: string
  inviteToken?: string
}): Promise<void> {
  await apiFetch("/api/auth/password/login", { method: "POST", body: input })
}

export async function register(input: {
  displayName: string
  email: string
  password: string
  inviteToken?: string
}): Promise<{ authenticated: boolean; confirmationRequired: boolean }> {
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
    body: { email },
  })
}

export async function completePasswordReset(input: {
  tokenHash: string
  password: string
}): Promise<void> {
  await apiFetch("/api/auth/password/reset/complete", {
    method: "POST",
    body: input,
  })
}

export async function resendConfirmation(email: string): Promise<void> {
  await apiFetch("/api/auth/password/resend", {
    method: "POST",
    body: { email },
  })
}

export async function signOut(): Promise<void> {
  await apiFetch("/api/session", { method: "DELETE" })
}

export async function lookupInvitation(token: string, options?: RequestOptions) {
  return apiFetch(`/api/invitations/${encodeURIComponent(token)}`, {
    schema: invitationSchema,
    ...options,
  })
}
