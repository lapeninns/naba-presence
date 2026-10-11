import { MEMBER_ROLES, type MemberRole, roleLabel } from "@/lib/settings/forms/invitation"

export type SettingsCapabilities = {
  canManageTeam: boolean
  canManageConnections: boolean
  canEditSettings: boolean
}

export function settingsGatingFromRole(role: string | null): SettingsCapabilities {
  const managerial = role === "owner" || role === "admin"
  return {
    canManageTeam: managerial,
    canManageConnections: managerial,
    canEditSettings: managerial,
  }
}

/** Access to the Data and privacy area (settings capabilities `privacy`). */
export type PrivacyAccess = "none" | "read" | "manage"

/**
 * Mirror of the server's `privacy` settings capability: an owner manages,
 * an admin reads, nobody else sees the area, and nobody does while the
 * organisation's `privacy_settings` feature is off.
 */
export function privacyAccessFromRole(
  role: string | null,
  featureEnabled: boolean
): PrivacyAccess {
  if (!featureEnabled) return "none"
  if (role === "owner") return "manage"
  if (role === "admin") return "read"
  return "none"
}

export type PrivacyGating = {
  /** See the area: requests, holds and retention status. */
  canViewPrivacy: boolean
  /** Log a new request (owners and admins: POST /api/privacy/requests). */
  canCreateRequests: boolean
  /**
   * Fulfil or reject requests, apply or release legal holds, export a
   * subject's records (owners only: the PATCH, legal-hold writes and export
   * routes are `roles: ["owner"]`).
   */
  canManagePrivacy: boolean
}

export function privacyGating(access: PrivacyAccess | undefined): PrivacyGating {
  return {
    canViewPrivacy: access === "read" || access === "manage",
    canCreateRequests: access === "read" || access === "manage",
    canManagePrivacy: access === "manage",
  }
}

export function managePrivacyDisabledReason(gating: PrivacyGating): string | null {
  return gating.canManagePrivacy ? null : "Only an owner can do this."
}

export function editSettingsDisabledReason(caps: SettingsCapabilities | undefined): string | null {
  if (!caps) return null
  return caps.canEditSettings ? null : "Only owners and admins can change these settings."
}

export function manageTeamDisabledReason(caps: SettingsCapabilities | undefined): string | null {
  if (!caps) return null
  return caps.canManageTeam ? null : "Only owners and admins can manage the team."
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
