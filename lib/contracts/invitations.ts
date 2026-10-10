/**
 * Wire contract for `/api/invitations/**`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. The routes parse
 * params/bodies with the request schemas; `lib/api/invitations.ts` and
 * `lib/api/auth.ts` (`lookupInvitation`) parse responses with the response
 * schemas.
 */
import { z } from "zod"

import { locationScopeSchema, memberRoleSchema } from "./members"

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** POST `/api/invitations` body. */
export const invitationCreateSchema = z
  .object({
    email: z.email().transform((value) => value.toLowerCase()),
    role: memberRoleSchema,
    canPublish: z.boolean().default(false),
    /**
     * Scope a member or viewer to these clients. Left out, they join seeing
     * every client. On acceptance each client becomes one location_member row
     * per listing filed under it then (supabase 0056); never an empty list,
     * because an assigned scope with nothing in it gives no access.
     */
    clientIds: z.array(z.uuid()).min(1).max(200).optional(),
    /**
     * Business workspaces grant a location at a time: scope a member or
     * viewer to exactly these listings (supabase 0043 `location_ids`, 0063
     * scope). Mutually exclusive with `clientIds`.
     */
    locationIds: z.array(z.uuid()).min(1).max(500).optional(),
  })
  .refine((input) => !(input.clientIds && input.locationIds), {
    message: "Scope an invitation by clients or by locations, not both.",
    path: ["locationIds"],
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
  /** The listings a business invitation is scoped to; null or absent: none named. */
  locations: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .nullable()
    .optional(),
  /** `assigned` when clients or locations are named (supabase 0063). */
  locationScope: locationScopeSchema.optional(),
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
