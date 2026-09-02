import { apiFetch, type RequestOptions } from "./client"
import {
  memberRemovedResponseSchema,
  memberUpdatedResponseSchema,
  membersResponseSchema,
  type MemberRemoveInput,
  type MemberUpdateInput,
} from "@/lib/contracts/members"

export { memberSchema, type Member, type MemberRole } from "@/lib/contracts/members"

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
