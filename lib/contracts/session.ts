/**
 * Wire contract for `/api/session/**` and `/api/organisations`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. The switch route
 * parses its body with `sessionSwitchSchema`; `lib/api/session.ts` and the
 * dashboard layout parse the session projection with `sessionSchema`.
 */
import { z } from "zod"

import { memberRoleSchema } from "./members"

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** POST `/api/session/switch` body. */
export const sessionSwitchSchema = z.object({ organisationId: z.uuid() })
export type SessionSwitchInput = z.infer<typeof sessionSwitchSchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** The session projection the client sees (no session id or secrets). */
export const sessionSchema = z.object({
  userId: z.string(),
  organisationId: z.string(),
  organisationName: z.string(),
  displayName: z.string(),
  email: z.string(),
  role: memberRoleSchema,
  canPublish: z.boolean(),
})
export type SessionUser = z.infer<typeof sessionSchema>

/** GET `/api/session` and POST `/api/session/switch` response. */
export const sessionResponseSchema = z.object({
  session: sessionSchema.nullable(),
})
export type SessionResponse = z.infer<typeof sessionResponseSchema>

export const organisationSummarySchema = z.object({
  organisationId: z.string(),
  name: z.string(),
  role: memberRoleSchema,
})
export type OrganisationSummary = z.infer<typeof organisationSummarySchema>

/** GET `/api/organisations` response. */
export const organisationsResponseSchema = z.object({
  items: z.array(organisationSummarySchema),
})
export type OrganisationsResponse = z.infer<typeof organisationsResponseSchema>
