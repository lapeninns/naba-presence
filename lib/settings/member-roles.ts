// The workspace roles and their labels, apart from the invitation form so
// the shell (command palette gating) can read them without loading zod.
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
