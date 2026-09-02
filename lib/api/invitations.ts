import { apiFetch, type RequestOptions } from "./client"
import {
  invitationCreatedResponseSchema,
  invitationRevokedResponseSchema,
  invitationsResponseSchema,
  type InvitationCreateInput,
} from "@/lib/contracts/invitations"

export { invitationSchema, type Invitation } from "@/lib/contracts/invitations"

export function fetchInvitations(options?: RequestOptions) {
  return apiFetch("/api/invitations", { schema: invitationsResponseSchema, ...options })
}

export function createInvitation(input: InvitationCreateInput) {
  return apiFetch("/api/invitations", {
    method: "POST",
    body: input,
    schema: invitationCreatedResponseSchema,
  })
}

export function revokeInvitation(id: string) {
  return apiFetch(`/api/invitations/${id}`, {
    method: "DELETE",
    schema: invitationRevokedResponseSchema,
  })
}
