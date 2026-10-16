import { apiFetch, type RequestOptions } from "./client"
import type { ClientAccessUpdateInput } from "@/lib/contracts/client-access"
import type {
  MemberRemoveInput,
  MemberUpdateInput,
} from "@/lib/contracts/members"

export type {
  Member,
  MemberClientTotal,
  MemberRole,
} from "@/lib/contracts/members"

export function fetchMembers(options?: RequestOptions) {
  return apiFetch("/api/members", {
    schema: () =>
      import("@/lib/contracts/members").then((m) => m.membersResponseSchema),
    ...options,
  })
}

export function updateMember(input: MemberUpdateInput) {
  return apiFetch("/api/members", {
    method: "PATCH",
    body: input,
    schema: () =>
      import("@/lib/contracts/members").then(
        (m) => m.memberUpdatedResponseSchema
      ),
  })
}

export function removeMember(userId: string) {
  return apiFetch("/api/members", {
    method: "DELETE",
    body: { userId } satisfies MemberRemoveInput,
    schema: () =>
      import("@/lib/contracts/members").then(
        (m) => m.memberRemovedResponseSchema
      ),
  })
}

export function fetchClientAccess(userId: string, options?: RequestOptions) {
  return apiFetch(`/api/members/${encodeURIComponent(userId)}/client-access`, {
    schema: () =>
      import("@/lib/contracts/client-access").then(
        (m) => m.clientAccessResponseSchema
      ),
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
    schema: () =>
      import("@/lib/contracts/client-access").then(
        (m) => m.clientAccessResponseSchema
      ),
  })
}
