/**
 * Wire contract for `/api/auth/password/**`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. The request
 * schemas come from `lib/domain/auth` (shared with the sign-in/register
 * forms) and are re-exported here so routes and `lib/api/auth.ts` have one
 * import site; the response schemas are declared here.
 */
import { z } from "zod"

import {
  emailSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  resetRequestSchema,
} from "@/lib/domain/auth"

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export { loginSchema, registerSchema, resetPasswordSchema, resetRequestSchema }

/** POST `/api/auth/password/login` body. */
export type SignInInput = z.input<typeof loginSchema>
/** POST `/api/auth/password/register` body. */
export type RegisterInput = z.input<typeof registerSchema>
/** POST `/api/auth/password/reset/request` body. */
export type ResetRequestInput = z.input<typeof resetRequestSchema>
/** POST `/api/auth/password/reset/complete` body. */
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>

/**
 * POST `/api/auth/password/resend` body. `inviteToken` mirrors the register
 * body: the resent confirmation link has to carry the invitation, or
 * `/auth/confirm` provisions the invited user as owner of a new organisation.
 */
export const resendConfirmationSchema = z.object({
  email: emailSchema,
  inviteToken: z.string().min(1).optional(),
})
export type ResendConfirmationInput = z.input<typeof resendConfirmationSchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * POST `/api/auth/password/login` response. `mfaRequired`: the password was
 * right, the person has two-step verification, and no session exists yet;
 * the browser holds a short-lived ticket and goes to `/sign-in/verify`.
 */
export const loginResponseSchema = z.object({
  authenticated: z.boolean(),
  mfaRequired: z.boolean().optional(),
})
export type LoginResponse = z.infer<typeof loginResponseSchema>

/**
 * POST `/api/auth/password/register` response: 200 when the identity is
 * signed in immediately, 202 with `confirmationRequired` otherwise.
 */
export const registerResponseSchema = z.object({
  authenticated: z.boolean(),
  confirmationRequired: z.boolean().optional(),
})
export type RegisterResponse = z.infer<typeof registerResponseSchema>

/** POST `/api/auth/password/resend` response (202). */
export const resendConfirmationResponseSchema = z.object({
  accepted: z.literal(true),
})
export type ResendConfirmationResponse = z.infer<
  typeof resendConfirmationResponseSchema
>

/** POST `/api/auth/password/reset/request` response (202). */
export const resetRequestResponseSchema = z.object({
  accepted: z.literal(true),
  message: z.string(),
})
export type ResetRequestResponse = z.infer<typeof resetRequestResponseSchema>

/** POST `/api/auth/password/reset/complete` response. */
export const resetCompleteResponseSchema = z.object({
  updated: z.literal(true),
  authenticated: z.boolean(),
  /** As for login: the new password is set, the code is still owed. */
  mfaRequired: z.boolean().optional(),
})
export type ResetCompleteResponse = z.infer<typeof resetCompleteResponseSchema>

// ---------------------------------------------------------------------------
// Two-step verification: `/api/auth/mfa/**` (P02-S8)
// ---------------------------------------------------------------------------

/** A six-digit TOTP code; spaces a person types between groups are dropped. */
export const totpCodeSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code."))

/** POST `/api/auth/mfa/verify` body. */
export const mfaVerifySchema = z.object({
  code: totpCodeSchema,
  /** Which of the person's factors the code is from (sign-in only). */
  factorId: z.string().min(1).max(128).optional(),
})
export type MfaVerifyInput = z.input<typeof mfaVerifySchema>

/** POST `/api/auth/mfa/verify` response. */
export const mfaVerifyResponseSchema = z.object({
  verified: z.literal(true),
  purpose: z.enum(["sign_in", "enroll"]),
})
export type MfaVerifyResponse = z.infer<typeof mfaVerifyResponseSchema>

export const mfaFactorSchema = z.object({
  id: z.string(),
  friendlyName: z.string().nullable(),
})
export type MfaFactor = z.infer<typeof mfaFactorSchema>

/** GET `/api/auth/mfa/factors` response: what the pending sign-in may use. */
export const mfaFactorsResponseSchema = z.object({
  factors: z.array(mfaFactorSchema),
  expiresAt: z.string(),
})
export type MfaFactorsResponse = z.infer<typeof mfaFactorsResponseSchema>

/**
 * POST `/api/auth/mfa/enroll` body. The password is asked again because the
 * app keeps no provider token for a session; `code` (from the existing
 * factor) is required to add a backup, which the provider allows only at
 * aal2.
 */
export const mfaEnrollSchema = z.object({
  password: z.string().min(1).max(200),
  code: totpCodeSchema.optional(),
})
export type MfaEnrollInput = z.input<typeof mfaEnrollSchema>

/** POST `/api/auth/mfa/enroll` response: what the authenticator app needs. */
export const mfaEnrollResponseSchema = z.object({
  factorId: z.string(),
  /** An image (data URI) of the otpauth URI as a QR code. */
  qrCode: z.string(),
  /** The secret, for typing in by hand. */
  secret: z.string(),
  uri: z.string(),
  /** 1 for the first factor, 2 for the backup. */
  factorNumber: z.number().int().min(1),
})
export type MfaEnrollResponse = z.infer<typeof mfaEnrollResponseSchema>
