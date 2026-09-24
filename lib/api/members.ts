import { apiFetch, type RequestOptions } from "./client"
import {
  clientAccessResponseSchema,
  type ClientAccessUpdateInput,
} from "@/lib/contracts/client-access"
import {
  memberRemovedResponseSchema,
  memberUpdatedResponseSchema,
  membersResponseSchema,
  type MemberRemoveInput,
  type MemberUpdateInput,
} from "@/lib/contracts/members"

export {
  memberSchema,
  type Member,
  type MemberClientTotal,
  type MemberRole,
} from "@/lib/contracts/members"

export function fetchMembers(options?: RequestOptions) {
  return apiFetch("/api/members", { schema: membersResponseSchema, ...options })
}

export function updateMember(input: MemberUpdateInput) {
  return apiFetch("/api/members", {
    method: "PATCH",
    body: input,
    schema: memberUpdatedResponseSchema,
  })
}

export function removeMember(userId: string) {
  return apiFetch("/api/members", {
    method: "DELETE",
    body: { userId } satisfies MemberRemoveInput,
    schema: memberRemovedResponseSchema,
  })
}

export function fetchClientAccess(userId: string, options?: RequestOptions) {
  return apiFetch(`/api/members/${encodeURIComponent(userId)}/client-access`, {
    schema: clientAccessResponseSchema,
    ...options,
  })
}

export function updateClientAccess(
  userId: string,
  input: ClientAccessUpdateInput
) {
  return apiFetch(`/api/members/${encodeURIComponent(userId)}/client-access`, {
    method: "PUT",
    body: input,
    schema: clientAccessResponseSchema,
  })
}
