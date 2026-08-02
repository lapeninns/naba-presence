import { z } from "zod"

export const MEMBER_ROLES = ["owner", "admin", "member", "viewer"] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
}

export function roleLabel(role: MemberRole): string {
  return ROLE_LABELS[role]
}

export const ROLE_OPTIONS = MEMBER_ROLES.map((value) => ({ value, label: ROLE_LABELS[value] }))

export const invitationFormSchema = z.object({
  email: z
    .email("Enter a valid email address.")
    .transform((value) => value.toLowerCase()),
  role: z.enum(MEMBER_ROLES),
  canPublish: z.boolean().default(false),
})

export type InvitationFormValues = z.infer<typeof invitationFormSchema>
