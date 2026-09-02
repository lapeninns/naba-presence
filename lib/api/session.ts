import { z } from "zod"

import { apiFetch, type RequestOptions } from "./client"

export const sessionSchema = z.object({
  userId: z.string(),
  organisationId: z.string(),
  organisationName: z.string(),
  displayName: z.string(),
  email: z.string(),
  role: z.enum(["owner", "admin", "member", "viewer"]),
  canPublish: z.boolean(),
})

export const sessionResponseSchema = z.object({
  session: sessionSchema.nullable(),
})

export type SessionUser = z.infer<typeof sessionSchema>
export type SessionResponse = z.infer<typeof sessionResponseSchema>

export function fetchSession(options?: RequestOptions) {
  return apiFetch("/api/session", { schema: sessionResponseSchema, ...options })
}
