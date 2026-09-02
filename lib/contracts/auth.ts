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

/** POST `/api/auth/password/resend` body. */
export const resendConfirmationSchema = z.object({ email: emailSchema })
export type ResendConfirmationInput = z.input<typeof resendConfirmationSchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** POST `/api/auth/password/login` response. */
export const loginResponseSchema = z.object({ authenticated: z.literal(true) })
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
  authenticated: z.literal(true),
})
export type ResetCompleteResponse = z.infer<typeof resetCompleteResponseSchema>
