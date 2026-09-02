/**
 * Wire contract for `/api/invitations/**`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. The routes parse
 * params/bodies with the request schemas; `lib/api/invitations.ts` and
 * `lib/api/auth.ts` (`lookupInvitation`) parse responses with the response
 * schemas.
 */
import { z } from "zod"

import { memberRoleSchema } from "./members"

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** POST `/api/invitations` body. */
export const invitationCreateSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  role: memberRoleSchema,
  canPublish: z.boolean().default(false),
})
export type InvitationCreateInput = z.input<typeof invitationCreateSchema>

/** GET `/api/invitations/[token]` params: the raw invite token. */
export const invitationLookupParamsSchema = z.object({ token: z.string() })

/** DELETE `/api/invitations/[token]` params: the invitation id. */
export const invitationRevokeParamsSchema = z.object({ token: z.uuid() })

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const invitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: memberRoleSchema,
  canPublish: z.boolean(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  inviteUrl: z.string().optional(),
})
export type Invitation = z.infer<typeof invitationSchema>

/** GET `/api/invitations` response. */
export const invitationsResponseSchema = z.object({ items: z.array(invitationSchema) })
export type InvitationsResponse = z.infer<typeof invitationsResponseSchema>

/** POST `/api/invitations` response (201). */
export const invitationCreatedResponseSchema = z.object({
  invitation: invitationSchema,
  inviteUrl: z.string(),
})
export type InvitationCreatedResponse = z.infer<typeof invitationCreatedResponseSchema>

/** DELETE `/api/invitations/[token]` response. */
export const invitationRevokedResponseSchema = z.object({ revoked: z.literal(true) })
export type InvitationRevokedResponse = z.infer<typeof invitationRevokedResponseSchema>

/** GET `/api/invitations/[token]` response (public invite lookup). */
export const invitationLookupSchema = z.object({
  organisationName: z.string(),
  email: z.string(),
  accepted: z.boolean(),
  expired: z.boolean(),
})
export type InvitationLookup = z.infer<typeof invitationLookupSchema>
