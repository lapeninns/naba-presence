import { MEMBER_ROLES, type MemberRole, roleLabel } from "@/lib/settings/forms/invitation"

export type SettingsCapabilities = {
  canManageTeam: boolean
  canManageConnections: boolean
  canEditSettings: boolean
  canViewCompliance: boolean
  canManageCompliance: boolean
}

export function settingsGatingFromRole(role: string | null): SettingsCapabilities {
  const managerial = role === "owner" || role === "admin"
  return {
    canManageTeam: managerial,
    canManageConnections: managerial,
    canEditSettings: managerial,
    canViewCompliance: managerial,
    canManageCompliance: role === "owner",
  }
}

export function editSettingsDisabledReason(caps: SettingsCapabilities | undefined): string | null {
  if (!caps) return null
  return caps.canEditSettings ? null : "Only owners and admins can change these settings."
}

export function manageTeamDisabledReason(caps: SettingsCapabilities | undefined): string | null {
  if (!caps) return null
  return caps.canManageTeam ? null : "Only owners and admins can manage the team."
}

export function manageComplianceDisabledReason(caps: SettingsCapabilities | undefined): string | null {
  if (!caps) return null
  return caps.canManageCompliance ? null : "Only owners can manage data and compliance."
}

// The role select never offers "Owner" to a non-owner actor (server: assertRoleChangeAllowed).
export function roleOptionsFor(actorRole: string): Array<{ value: MemberRole; label: string }> {
  return MEMBER_ROLES.filter((role) => role !== "owner" || actorRole === "owner").map((role) => ({
    value: role,
    label: roleLabel(role),
  }))
}

export function memberRowGate(input: {
  actorRole: MemberRole
  actorUserId: string
  ownerCount: number
  member: { userId: string; role: MemberRole; canPublish: boolean }
}): {
  roleDisabled: boolean
  roleReason: string | null
  removeDisabled: boolean
  removeReason: string | null
  canPublishForced: boolean
} {
  const { actorRole, actorUserId, ownerCount, member } = input
  const isSelf = member.userId === actorUserId
  const targetIsOwner = member.role === "owner"
  const lastOwner = targetIsOwner && ownerCount <= 1
  // Non-owner actors can neither assign nor change an owner (server: owner_role_required).
  const actorCannotTouchOwner = actorRole !== "owner" && targetIsOwner

  const roleDisabled = lastOwner || actorCannotTouchOwner
  const roleReason = lastOwner
    ? "Make someone else an owner before changing the last owner’s role."
    : actorCannotTouchOwner
      ? "Only an owner can change an owner’s role."
      : null

  const removeDisabled = isSelf || lastOwner || actorCannotTouchOwner
  const removeReason = isSelf
    ? "You can’t remove your own access."
    : lastOwner
      ? "Make someone else an owner before removing the last owner."
      : actorCannotTouchOwner
        ? "Only an owner can remove an owner."
        : null

  return {
    roleDisabled,
    roleReason,
    removeDisabled,
    removeReason,
    canPublishForced: member.role === "viewer",
  }
}

const NOTIFICATION_LABELS: Record<string, string> = {
  GOOGLE_UPDATE: "Profile updates from Google",
  NEW_REVIEW: "New reviews",
  UPDATED_REVIEW: "Updated reviews",
  NEW_CUSTOMER_MEDIA: "New customer photos",
  DUPLICATE_LOCATION: "Duplicate location alerts",
  VOICE_OF_MERCHANT_UPDATED: "Verification status changes",
}

export function describeNotificationType(type: string): string {
  return NOTIFICATION_LABELS[type] ?? type
}
