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
     * viewer to exactly these listings (supabase 0043 `location_ids`, 0082
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

/**
 * POST `/api/invitations/[token]/resend` params: the invitation id (the
 * segment is named `token` because it shares the folder with the public
 * lookup).
 */
export const invitationResendParamsSchema = z.object({ token: z.uuid() })

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * Where an invitation email stands (supabase 0104 invitation_delivery, the
 * shared email driver's states): `pending` queued or retrying, `sent` the
 * provider accepted it, `failed` it certainly did not go out, `suppressed`
 * deliberately not sent (see `errorCode`), `uncertain` it may have gone out.
 */
export const invitationDeliveryStatusSchema = z.enum([
  "pending",
  "sent",
  "failed",
  "suppressed",
  "uncertain",
])
export type InvitationDeliveryStatus = z.infer<
  typeof invitationDeliveryStatusSchema
>

/** The latest email the app tried to send for an invitation. */
export const invitationDeliverySchema = z.object({
  id: z.string(),
  kind: z.enum(["initial", "resend"]),
  status: invitationDeliveryStatusSchema,
  /**
   * Why it is not sent, when it is not: `provider_not_configured`,
   * `tenant_email_disabled`, `invitation_email_rate_limited`,
   * `invitation_accepted`, `invitation_expired`, `email_http_<status>`,
   * `email_timeout` and the like. Never a provider error body.
   */
  errorCode: z.string().nullable(),
  attempts: z.number().int(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
})
export type InvitationDelivery = z.infer<typeof invitationDeliverySchema>

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
  /** `assigned` when clients or locations are named (supabase 0082). */
  locationScope: locationScopeSchema.optional(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  inviteUrl: z.string().optional(),
  /** The latest invitation email; null when the app never sent one. */
  delivery: invitationDeliverySchema.nullable().optional(),
})
export type Invitation = z.infer<typeof invitationSchema>

/** GET `/api/invitations` response. */
export const invitationsResponseSchema = z.object({
  items: z.array(invitationSchema),
  /**
   * Whether this organisation's invitations are emailed by the app (the
   * `invitation_email` feature). Off or absent: the link is copied and sent
   * by the inviter.
   */
  emailDelivery: z.boolean().optional(),
})
export type InvitationsResponse = z.infer<typeof invitationsResponseSchema>

/** POST `/api/invitations` response (201). */
export const invitationCreatedResponseSchema = z.object({
  invitation: invitationSchema,
  inviteUrl: z.string(),
})

/** POST `/api/invitations/[token]/resend` response (202). */
export const invitationResentResponseSchema = z.object({
  delivery: invitationDeliverySchema,
})
export type InvitationResentResponse = z.infer<
  typeof invitationResentResponseSchema
>
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

/**
 * GET `/api/invitations/[token]` response (public invite lookup). Anyone
 * holding the token can read it, so it carries only what the invitee needs
 * to decide (D8): who invites them, to which address, the role they would
 * join with and when the link stops working. Never the inviter, the scope,
 * publishing access or any other invitation data.
 */
export const invitationLookupSchema = z.object({
  organisationName: z.string(),
  email: z.string(),
  role: memberRoleSchema,
  /** ISO 8601. */
  expiresAt: z.string(),
  accepted: z.boolean(),
  expired: z.boolean(),
})
export type InvitationLookup = z.infer<typeof invitationLookupSchema>
