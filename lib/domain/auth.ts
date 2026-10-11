import { z } from "zod"

import { workspaceModeSchema } from "@/lib/contracts/session"

export const emailSchema = z
  .string()
  .trim()
  .pipe(z.email())
  .transform((value) => value.toLowerCase())

export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128, "Use no more than 128 characters.")
  .regex(/[A-Za-z]/, "Include at least one letter.")
  .regex(/[0-9]/, "Include at least one number.")
  .regex(/[^A-Za-z0-9]/, "Include at least one symbol.")

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
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
  tokenHash: z.string().min(20).max(512),
  password: passwordSchema,
})
