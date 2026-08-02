import { z } from "zod"

import { apiFetch } from "./client"
import { MEMBER_ROLES, type MemberRole } from "@/lib/settings/forms/invitation"

export const memberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.enum(MEMBER_ROLES),
  canPublish: z.boolean(),
  createdAt: z.string(),
  locations: z.array(z.object({ locationId: z.string(), canPublish: z.boolean() })),
})

const membersResponseSchema = z.object({ members: z.array(memberSchema) })
const memberResponseSchema = z.object({
  member: z.object({
    userId: z.string(),
    role: z.enum(MEMBER_ROLES),
    canPublish: z.boolean(),
    createdAt: z.string(),
  }),
})
const removedResponseSchema = z.object({ removed: z.literal(true) })

export type Member = z.infer<typeof memberSchema>
export type { MemberRole }

export function fetchMembers() {
  return apiFetch("/api/members", { schema: membersResponseSchema })
}

export function updateMember(input: { userId: string; role: MemberRole; canPublish: boolean }) {
  return apiFetch("/api/members", { method: "PATCH", body: input, schema: memberResponseSchema })
}

export function removeMember(userId: string) {
  return apiFetch("/api/members", { method: "DELETE", body: { userId }, schema: removedResponseSchema })
}
