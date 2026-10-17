import { z } from "zod"

import {
  PASSWORD_LENGTH,
  PASSWORD_MAX_CODE_UNITS,
  RESET_TOKEN_HASH_LENGTH,
  passwordLength,
} from "@/lib/domain/auth-limits"
import { workspaceModeSchema } from "@/lib/contracts/session"

export const emailSchema = z
  .string()
  .trim()
  .pipe(z.email())
  .transform((value) => value.toLowerCase())

/**
 * A new password: length only, 15 to 128 characters counted in code points
 * (so six emoji are six characters, not twelve), with no letter, number or
 * symbol rules (NIST SP 800-63B-4: composition rules push people to
 * predictable patterns without adding strength). Any character counts,
 * spaces included, so a passphrase works. The register and reset routes also
 * refuse a password found in a breach (lib/server/breached-password.ts).
 * Sign-in never applies this schema, so passwords set under the earlier
 * 12-character minimum keep working.
 */
export const passwordSchema = z
  .string()
  // A cheap bound first: 128 code points are at most 256 UTF-16 code units,
  // so anything longer fails here and `abort` skips the code-point count.
  .max(PASSWORD_MAX_CODE_UNITS, {
    message: "Use no more than 128 characters.",
    abort: true,
  })
  .refine((value) => passwordLength(value) >= PASSWORD_LENGTH.min, {
    message: "Use at least 15 characters.",
  })
  .refine((value) => passwordLength(value) <= PASSWORD_LENGTH.max, {
    message: "Use no more than 128 characters.",
  })

export const loginSchema = z.object({
  email: emailSchema,
  // Up to what passwordSchema can accept (128 code points), so a password
  // someone could set can always be signed in with.
  password: z.string().min(1).max(PASSWORD_MAX_CODE_UNITS),
  inviteToken: z.string().min(1).optional(),
})

export const registerSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
  inviteToken: z.string().min(1).optional(),
  /**
   * The kind of workspace a new owner starts with: one business (the
   * default) or an agency with clients. Ignored when `inviteToken` is set,
   * because an invited person joins the inviting organisation as it is.
   */
  workspaceMode: workspaceModeSchema.default("business"),
})

export const resetRequestSchema = z.object({
  email: emailSchema,
})

export const resetPasswordSchema = z.object({
  tokenHash: z
    .string()
    .min(RESET_TOKEN_HASH_LENGTH.min)
    .max(RESET_TOKEN_HASH_LENGTH.max),
  password: passwordSchema,
})
