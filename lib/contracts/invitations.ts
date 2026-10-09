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
  /**
   * Scope a member or viewer to these clients. Left out, they join seeing
   * every client. On acceptance each client becomes one location_member row
   * per listing filed under it then (supabase 0056); never an empty list,
   * because no rows means every client.
   */
  clientIds: z.array(z.uuid()).min(1).max(200).optional(),
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
  /** The clients the invitation is scoped to; null or absent: all clients. */
  clients: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .nullable()
    .optional(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  inviteUrl: z.string().optional(),
})
export type Invitation = z.infer<typeof invitationSchema>

/** GET `/api/invitations` response. */
export const invitationsResponseSchema = z.object({
  items: z.array(invitationSchema),
})
export type InvitationsResponse = z.infer<typeof invitationsResponseSchema>

/** POST `/api/invitations` response (201). */
export const invitationCreatedResponseSchema = z.object({
  invitation: invitationSchema,
  inviteUrl: z.string(),
})
export type InvitationCreatedResponse = z.infer<
  typeof invitationCreatedResponseSchema
>

/** DELETE `/api/invitations/[token]` response. */
export const invitationRevokedResponseSchema = z.object({
  revoked: z.literal(true),
})
export type InvitationRevokedResponse = z.infer<
  typeof invitationRevokedResponseSchema
>

/** POST `/api/invitations/[token]` response: accepted with the current session. */
export const invitationAcceptedResponseSchema = z.object({
  accepted: z.literal(true),
  organisationId: z.string(),
})
export type InvitationAcceptedResponse = z.infer<
  typeof invitationAcceptedResponseSchema
>

/** GET `/api/invitations/[token]` response (public invite lookup). */
export const invitationLookupSchema = z.object({
  organisationName: z.string(),
  email: z.string(),
  accepted: z.boolean(),
  expired: z.boolean(),
})
export type InvitationLookup = z.infer<typeof invitationLookupSchema>
