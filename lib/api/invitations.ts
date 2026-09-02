import { z } from "zod"

import { apiFetch, type RequestOptions } from "./client"
import { MEMBER_ROLES, type MemberRole } from "@/lib/settings/forms/invitation"

export const invitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(MEMBER_ROLES),
  canPublish: z.boolean(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  inviteUrl: z.string().optional(),
})

const invitationsResponseSchema = z.object({ items: z.array(invitationSchema) })
const createResponseSchema = z.object({ invitation: invitationSchema, inviteUrl: z.string() })
const revokedResponseSchema = z.object({ revoked: z.literal(true) })

export type Invitation = z.infer<typeof invitationSchema>

export function fetchInvitations(options?: RequestOptions) {
  return apiFetch("/api/invitations", { schema: invitationsResponseSchema, ...options })
}

export function createInvitation(input: { email: string; role: MemberRole; canPublish: boolean }) {
  return apiFetch("/api/invitations", { method: "POST", body: input, schema: createResponseSchema })
}

export function revokeInvitation(id: string) {
  return apiFetch(`/api/invitations/${id}`, { method: "DELETE", schema: revokedResponseSchema })
}
