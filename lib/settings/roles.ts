import type { Member, MemberClientTotal } from "@/lib/contracts/members"
import {
  describeMemberAccess,
  summariseClientAccess,
} from "@/lib/settings/client-access"
import type { MemberRole } from "@/lib/settings/forms/invitation"

/**
 * Presentation copy for the four organisation roles, written against the
 * rules the server enforces (lib/server/permissions.ts, capabilities.ts,
 * member-roles.ts, review-approval.ts and the settings route). Nothing here
 * decides access; it only describes what the server already decides.
 * tests/role-copy.test.ts ties every line below to those rules, so a change
 * to a rule that this copy no longer matches fails there.
 *
 * Two lengths: `ROLE_SUMMARIES` is the one-line sub-label every role row
 * carries in the picker; `ROLE_DESCRIPTIONS` is the full sentence shown for
 * the selected row, on Team and in the change-role sheet.
 */
export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  owner:
    "Everything an admin can do. Only owners can change or remove another owner, or turn reply approval off.",
  admin:
    "Manages the team, Google connections and the reply policy. Sees, edits and publishes for every client.",
  member:
    "Drafts replies and posts for the listings they can see. Can’t edit a listing’s profile, hours or menu. Publishes only when publishing access is on.",
  viewer:
    "Reads reviews, listings and reports they can see. Can’t draft, publish or change anything.",
}

export const ROLE_SUMMARIES: Record<MemberRole, string> = {
  owner: "Everything an admin can do, and can change other owners",
  admin: "Manages the team and every client’s listings",
  member: "Drafts replies and posts; publishes only if allowed",
  viewer: "Reads reviews and reports; can’t change anything",
}

/** The role copy for a workspace mode: a business has no clients to see. */
export function roleDescriptions(
  mode: "business" | "agency"
): Record<MemberRole, string> {
  return mode === "business"
    ? {
        ...ROLE_DESCRIPTIONS,
        admin:
          "Manages the team, Google connections and the reply policy. Sees, edits and publishes for every location.",
      }
    : ROLE_DESCRIPTIONS
}

/**
 * The one-line summary for a role where the workspace mode isn't known: the
 * public invitation page, whose lookup carries only the role (D8). The same
 * lines as `ROLE_SUMMARIES`, with the admin's worded to be true in both
 * modes.
 */
export function invitationRoleSummary(role: MemberRole): string {
  return role === "admin"
    ? "Manages the team and every listing"
    : ROLE_SUMMARIES[role]
}

/** The one-line role sub-labels for a workspace mode. */
export function roleSummaries(
  mode: "business" | "agency"
): Record<MemberRole, string> {
  return mode === "business"
    ? {
        ...ROLE_SUMMARIES,
        admin: "Manages the team and every location’s listings",
      }
    : ROLE_SUMMARIES
}

/** "an admin", "a member": the role as a noun phrase in a sentence. */
export function roleWithArticle(role: MemberRole): string {
  return role === "admin" || role === "owner" ? `an ${role}` : `a ${role}`
}

export type Capability =
  { kind: "yes" } | { kind: "no" } | { kind: "conditional"; text: string }

const YES: Capability = { kind: "yes" }
const NO: Capability = { kind: "no" }
const THEIR: Capability = { kind: "conditional", text: "Listings they can see" }
const IF_PUBLISH: Capability = {
  kind: "conditional",
  text: "If publishing access is on",
}

/**
 * The permission explainer on Team, one row per capability, in role order
 * owner · admin · member · viewer.
 */
export const ROLE_MATRIX: { capability: string; cells: Capability[] }[] = [
  {
    capability: "See reviews, listings and reports",
    cells: [YES, YES, THEIR, THEIR],
  },
  {
    capability: "Draft replies and posts",
    cells: [YES, YES, THEIR, NO],
  },
  {
    capability: "Edit a listing’s profile, hours or menu",
    cells: [YES, YES, NO, NO],
  },
  { capability: "Publish to Google", cells: [YES, YES, IF_PUBLISH, NO] },
  {
    capability: "Approve someone else’s reply",
    cells: [YES, YES, IF_PUBLISH, NO],
  },
  { capability: "Manage the team and invitations", cells: [YES, YES, NO, NO] },
  {
    capability: "Google connections and reply policy",
    cells: [YES, YES, NO, NO],
  },
  { capability: "Turn reply approval off", cells: [YES, NO, NO, NO] },
  { capability: "Change or remove an owner", cells: [YES, NO, NO, NO] },
]

/**
 * Which clients a member can see, for the Team row. Owners and admins see
 * everything; a member or viewer on scope `all` sees every client, including
 * ones added later; one on `assigned` sees the clients their rows fall in,
 * "Old Crown (3 of 5 listings)" when older per-listing grants hold only part
 * of a client, and nothing when they hold no rows (lib/server/permissions.ts,
 * lib/settings/client-access.ts). Without `clients` (a response from before
 * client access) it falls back to a listing count.
 */
export function accessSummary(
  member: Pick<Member, "role" | "locations" | "locationScope">,
  clients?: MemberClientTotal[],
  mode: "business" | "agency" = "agency"
): {
  label: string
  detail: string | null
} {
  if (mode === "business") {
    // No client layer: access is a count of locations.
    if (member.role === "owner" || member.role === "admin") {
      return { label: "All locations", detail: null }
    }
    if (member.locationScope === "all") {
      return {
        label: "All locations",
        detail: "Including locations added later",
      }
    }
    const count = member.locations.length
    if (count === 0) {
      return {
        label: "No locations",
        detail: "Sees nothing until given access",
      }
    }
    return {
      label: count === 1 ? "1 location" : `${count} locations`,
      detail: null,
    }
  }
  if (clients) {
    return describeMemberAccess(
      member.role,
      summariseClientAccess(
        member.locations.map((location) => ({
          locationId: location.locationId,
          clientId: location.clientId ?? null,
          canPublish: location.canPublish,
        })),
        clients,
        member.locationScope
      )
    )
  }
  if (member.role === "owner" || member.role === "admin") {
    return { label: "All clients", detail: null }
  }
  if (member.locationScope === "all") {
    return { label: "All clients", detail: "Including clients added later" }
  }
  const count = member.locations.length
  if (count === 0) {
    return { label: "No clients", detail: "Sees nothing until given access" }
  }
  return {
    label: `${count} ${count === 1 ? "listing" : "listings"}`,
    detail: "Assigned per listing",
  }
}

export type PublishingState = {
  label: string
  tone: "ok" | "info" | "neutral"
  dashed?: boolean
  plain?: boolean
}

/** Whether a member can publish, by the same rule the server applies. */
export function publishingState(
  member: Pick<Member, "role" | "canPublish" | "locations">
): PublishingState {
  if (member.role === "owner" || member.role === "admin") {
    return { label: "Can publish", tone: "ok" }
  }
  if (member.role === "viewer") {
    return { label: "View only", tone: "neutral", plain: true }
  }
  if (member.locations.length === 0) {
    return member.canPublish
      ? { label: "Can publish", tone: "ok" }
      : { label: "Drafts only", tone: "neutral", dashed: true }
  }
  const publishable = member.locations.filter((l) => l.canPublish).length
  if (publishable === member.locations.length) {
    return { label: "Can publish", tone: "ok" }
  }
  if (publishable === 0) {
    return { label: "Drafts only", tone: "neutral", dashed: true }
  }
  return {
    label: `Publishes to ${publishable} of ${member.locations.length}`,
    tone: "info",
  }
}

/**
 * "12 Sep 2026", for joined and sent dates: in `timeZone`, or the viewer's
 * own zone without one. A server-rendered list uses `useFormatDay`
 * (lib/settings/use-format-day.ts) so it hydrates cleanly.
 */
export function formatDay(iso: string, timeZone?: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(timeZone ? { timeZone } : {}),
  })
}
