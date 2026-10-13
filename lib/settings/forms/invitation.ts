import { z } from "zod"

import { MEMBER_ROLES } from "@/lib/settings/member-roles"

export {
  MEMBER_ROLES,
  ROLE_OPTIONS,
  roleLabel,
  type MemberRole,
} from "@/lib/settings/member-roles"

export const invitationFormSchema = z.object({
  email: z
    .email("Enter a valid email address.")
    .transform((value) => value.toLowerCase()),
  role: z.enum(MEMBER_ROLES),
  canPublish: z.boolean().default(false),
  /** Members and viewers only; left out means all clients. */
  clientIds: z.array(z.string()).min(1).optional(),
})

export type InvitationFormValues = z.infer<typeof invitationFormSchema>
