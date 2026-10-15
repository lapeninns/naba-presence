import { describe, expect, it } from "vitest"

import { editDisabledReason } from "@/lib/locations/gating"
import {
  locationActionCapabilities,
  settingsCapabilities,
} from "@/lib/server/capabilities"
import {
  isManagerialRole,
  memberGrant,
  actionAllowed,
} from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"
import { ROLE_CHOICE_ORDER, roleOptionsFor } from "@/lib/settings/gating"
import { MEMBER_ROLES, type MemberRole } from "@/lib/settings/member-roles"
import {
  ROLE_DESCRIPTIONS,
  ROLE_MATRIX,
  ROLE_SUMMARIES,
  roleDescriptions,
  roleSummaries,
} from "@/lib/settings/roles"

// The role copy ("Drafts replies and posts…", "Can’t change a listing’s
// profile…") is presentation. What each role can do is decided by the
// server's own rules, so this file computes the facts from those rules and
// holds every line of copy to them: change a rule, or the copy, and the
// other has to follow.

type Publishing = "always" | "if-allowed" | "never"

function sessionFor(role: MemberRole): Session {
  return {
    sessionId: "s",
    userId: "u",
    organisationId: "o",
    organisationName: "Org",
    workspaceMode: "agency",
    displayName: "Test",
    email: "test@example.test",
    role,
    canPublish: false,
  }
}

/** What the rules say a role can do, for a member whose scope is "all". */
function factsFor(role: MemberRole) {
  const grantWhen = (sessionCanPublish: boolean) =>
    memberGrant({
      role,
      sessionCanPublish,
      locationScope: "all",
      assignedPublish: null,
    })
  const off = grantWhen(false)
  const on = grantWhen(true)
  const publishing = (action: "publish" | "decide_approval"): Publishing => {
    const whenOff = actionAllowed(role, off, action)
    const whenOn = actionAllowed(role, on, action)
    return whenOff ? "always" : whenOn ? "if-allowed" : "never"
  }
  const settings = settingsCapabilities(sessionFor(role), {
    privacySettings: false,
  })
  return {
    // capabilities.ts: canEditCanonical === isManagerialRole(session.role)
    editsListingDetails: isManagerialRole(role),
    draftsContent: locationActionCapabilities(role, on).canEdit,
    publishing: publishing("publish"),
    approvesOthers: publishing("decide_approval"),
    managesTeam: settings.canManageTeam,
    managesConnections: settings.canManageConnections,
  }
}

describe("the facts the role copy is held to", () => {
  it("states the rules this copy depends on", () => {
    expect(factsFor("owner")).toMatchObject({
      editsListingDetails: true,
      draftsContent: true,
      publishing: "always",
      managesTeam: true,
    })
    expect(factsFor("admin")).toMatchObject({
      editsListingDetails: true,
      draftsContent: true,
      publishing: "always",
      managesTeam: true,
    })
    expect(factsFor("member")).toMatchObject({
      editsListingDetails: false,
      draftsContent: true,
      publishing: "if-allowed",
      approvesOthers: "if-allowed",
      managesTeam: false,
      managesConnections: false,
    })
    expect(factsFor("viewer")).toMatchObject({
      editsListingDetails: false,
      draftsContent: false,
      publishing: "never",
      managesTeam: false,
    })
  })

  it("is the rule behind the 'Only owners and admins can edit this location' message", () => {
    for (const role of MEMBER_ROLES) {
      const caps = { canEditCanonical: isManagerialRole(role) } as Parameters<
        typeof editDisabledReason
      >[0]
      expect(editDisabledReason(caps) === null).toBe(
        factsFor(role).editsListingDetails
      )
    }
  })
})

describe.each([
  ["agency", roleDescriptions("agency"), roleSummaries("agency")],
  ["business", roleDescriptions("business"), roleSummaries("business")],
] as const)("role copy in %s mode", (_mode, descriptions, summaries) => {
  describe.each(["admin", "member", "viewer"] as const)("%s", (role) => {
    const facts = factsFor(role)
    const full = descriptions[role]
    const short = summaries[role]

    it("claims listing edits only if the role can edit canonical listing details", () => {
      expect(/\bedits\b/i.test(full)).toBe(facts.editsListingDetails)
      if (!facts.editsListingDetails) {
        expect(full).toMatch(
          /can’t (change a listing’s profile, hours or menu|draft, publish or change anything)/i
        )
      }
    })

    it("says drafting in line with the rules", () => {
      if (role === "admin") return // admins' copy speaks of editing and publishing
      if (facts.draftsContent) {
        expect(full).toMatch(/^drafts replies and posts/i)
        expect(short).toMatch(/^drafts replies and posts/i)
      } else {
        expect(full).toMatch(/can’t draft/i)
        expect(short).not.toMatch(/\bdrafts\b/i)
      }
    })

    it("says publishing in line with the rules", () => {
      if (facts.publishing === "always") {
        expect(full).toMatch(/\bpublishes\b/i)
        expect(full).not.toMatch(/only when/i)
      } else if (facts.publishing === "if-allowed") {
        expect(full).toMatch(/publishes only when publishing access is on/i)
        expect(short).toMatch(/publishes only if allowed/i)
      } else {
        expect(full).toMatch(/can’t[^.]*publish/i)
        expect(short).not.toMatch(/publish/i)
      }
    })

    it("claims team management only if the role manages the team", () => {
      expect(/manages the team/i.test(full)).toBe(facts.managesTeam)
      expect(/manages the team/i.test(short)).toBe(facts.managesTeam)
    })
  })

  it("describes an owner as an admin plus owner-only powers, which the rules agree with", () => {
    expect(descriptions.owner).toMatch(/^everything an admin can do/i)
    expect(factsFor("owner")).toEqual(factsFor("admin"))
    expect(summaries.owner).toMatch(/^everything an admin can do/i)
  })

  it("names clients only in an agency workspace", () => {
    const text =
      Object.values(descriptions).join(" ") + Object.values(summaries).join(" ")
    expect(/\bclient/i.test(text)).toBe(_mode === "agency")
  })
})

describe("the permission table on Team", () => {
  // Columns follow MEMBER_ROLES: owner, admin, member, viewer.
  const row = (capability: string) => {
    const found = ROLE_MATRIX.find((r) => r.capability === capability)
    if (!found) throw new Error(`no matrix row: ${capability}`)
    return found.cells
  }
  const kinds = (cells: { kind: string }[]) => cells.map((c) => c.kind)

  it("agrees with the rules, role by role", () => {
    const facts = MEMBER_ROLES.map(factsFor)
    const yesOrNo = (flags: boolean[]) => flags.map((f) => (f ? "yes" : "no"))
    const tri = (values: Publishing[]) =>
      values.map((v) =>
        v === "always" ? "yes" : v === "never" ? "no" : "conditional"
      )

    expect(kinds(row("Change a listing’s profile, hours or menu"))).toEqual(
      yesOrNo(facts.map((f) => f.editsListingDetails))
    )
    expect(kinds(row("Publish to Google"))).toEqual(
      tri(facts.map((f) => f.publishing))
    )
    expect(kinds(row("Approve someone else’s reply"))).toEqual(
      tri(facts.map((f) => f.approvesOthers))
    )
    expect(kinds(row("Manage the team and invitations"))).toEqual(
      yesOrNo(facts.map((f) => f.managesTeam))
    )
    expect(kinds(row("Google connections and reply policy"))).toEqual(
      yesOrNo(facts.map((f) => f.managesConnections))
    )
    // Drafting: a member does it where they can see (conditional), a viewer never.
    expect(kinds(row("Draft replies and posts"))).toEqual(
      facts.map((f) =>
        f.draftsContent ? (isManagerial(f) ? "yes" : "conditional") : "no"
      )
    )
  })

  it("has a cell for every role in every row", () => {
    for (const r of ROLE_MATRIX)
      expect(r.cells).toHaveLength(MEMBER_ROLES.length)
  })
})

function isManagerial(facts: ReturnType<typeof factsFor>) {
  return facts.editsListingDetails
}

describe("role order", () => {
  it("offers Member, Viewer, Admin, Owner, once, covering every role", () => {
    expect([...ROLE_CHOICE_ORDER]).toEqual([
      "member",
      "viewer",
      "admin",
      "owner",
    ])
    expect([...ROLE_CHOICE_ORDER].sort()).toEqual([...MEMBER_ROLES].sort())
  })

  it("uses that order for what an owner can pick, and drops Owner for an admin", () => {
    expect(roleOptionsFor("owner").map((o) => o.value)).toEqual([
      "member",
      "viewer",
      "admin",
      "owner",
    ])
    expect(roleOptionsFor("admin").map((o) => o.value)).toEqual([
      "member",
      "viewer",
      "admin",
    ])
  })

  it("has a full description and a summary for every role", () => {
    for (const role of MEMBER_ROLES) {
      expect(ROLE_DESCRIPTIONS[role].length).toBeGreaterThan(0)
      expect(ROLE_SUMMARIES[role].length).toBeGreaterThan(0)
      expect(ROLE_SUMMARIES[role].length).toBeLessThan(
        ROLE_DESCRIPTIONS[role].length
      )
    }
  })
})
