import type { Member } from "@/lib/contracts/members"
import type { MemberRole } from "@/lib/settings/forms/invitation"

/**
 * Presentation copy for the four organisation roles, written against the
 * rules the server enforces (lib/server/permissions.ts, member-roles.ts,
 * review-approval.ts and the settings route). Nothing here decides access;
 * it only describes what the server already decides.
 */
export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  owner:
    "Everything an admin can do. Only owners can change or remove another owner, or turn reply approval off.",
  admin:
    "Manages the team, Google connections and the reply policy. Sees, edits and publishes for every client.",
  member:
    "Drafts replies and edits listings they can see. Publishes only when publishing access is on.",
  viewer:
    "Reads reviews, listings and reports they can see. Can’t draft, publish or change anything.",
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
    capability: "Draft replies and listing changes",
    cells: [YES, YES, THEIR, NO],
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
 * Which listings a member can see. Owners and admins see everything; a
 * member or viewer with no per-listing grants sees every listing, and one
 * with grants sees only those (lib/server/permissions.ts).
 */
export function accessSummary(member: Pick<Member, "role" | "locations">): {
  label: string
  detail: string | null
} {
  if (member.role === "owner" || member.role === "admin") {
    return { label: "All clients", detail: null }
  }
  const count = member.locations.length
  if (count === 0) {
    return { label: "All clients", detail: "No listings assigned yet" }
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

/** "12 Sep 2026", for joined and sent dates. */
export function formatDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}
