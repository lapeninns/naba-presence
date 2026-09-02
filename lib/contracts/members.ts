/**
 * Wire contract for `/api/members`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. The route parses
 * PATCH/DELETE bodies with the request schemas; `lib/api/members.ts` parses
 * responses with the response schemas. `memberRoleSchema` is the one
 * organisation-role vocabulary shared with invitations and the session.
 */
import { z } from "zod"

import { MEMBER_ROLES, type MemberRole } from "@/lib/settings/forms/invitation"

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export { MEMBER_ROLES }
export type { MemberRole }
export const memberRoleSchema = z.enum(MEMBER_ROLES)

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** PATCH `/api/members` body. */
export const memberUpdateSchema = z.object({
  userId: z.uuid(),
  role: memberRoleSchema,
  canPublish: z.boolean(),
})
export type MemberUpdateInput = z.infer<typeof memberUpdateSchema>

/** DELETE `/api/members` body. */
export const memberRemoveSchema = z.object({ userId: z.uuid() })
export type MemberRemoveInput = z.infer<typeof memberRemoveSchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const memberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: memberRoleSchema,
  canPublish: z.boolean(),
  createdAt: z.string(),
  locations: z.array(z.object({ locationId: z.string(), canPublish: z.boolean() })),
})
export type Member = z.infer<typeof memberSchema>

/** GET `/api/members` response. */
export const membersResponseSchema = z.object({ members: z.array(memberSchema) })
export type MembersResponse = z.infer<typeof membersResponseSchema>

/** PATCH `/api/members` response: the updated membership row. */
export const memberUpdatedResponseSchema = z.object({
  member: z.object({
    userId: z.string(),
    role: memberRoleSchema,
    canPublish: z.boolean(),
    createdAt: z.string(),
  }),
})
export type MemberUpdatedResponse = z.infer<typeof memberUpdatedResponseSchema>

/** DELETE `/api/members` response. */
export const memberRemovedResponseSchema = z.object({ removed: z.literal(true) })
export type MemberRemovedResponse = z.infer<typeof memberRemovedResponseSchema>
