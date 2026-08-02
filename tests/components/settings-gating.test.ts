import { describe, expect, it } from "vitest"

import { memberRowGate, roleOptionsFor, settingsGatingFromRole } from "@/lib/settings/gating"

describe("settingsGatingFromRole (mirror of server settingsCapabilities)", () => {
  it("matches the server predicates for every role", () => {
    expect(settingsGatingFromRole("owner")).toEqual({
      canManageTeam: true, canManageConnections: true, canEditSettings: true, canViewCompliance: true, canManageCompliance: true,
    })
    expect(settingsGatingFromRole("admin")).toEqual({
      canManageTeam: true, canManageConnections: true, canEditSettings: true, canViewCompliance: true, canManageCompliance: false,
    })
    for (const role of ["member", "viewer", null]) {
      expect(settingsGatingFromRole(role)).toEqual({
        canManageTeam: false, canManageConnections: false, canEditSettings: false, canViewCompliance: false, canManageCompliance: false,
      })
    }
  })
})

describe("roleOptionsFor", () => {
  it("offers Owner only to an owner actor", () => {
    expect(roleOptionsFor("owner").map((o) => o.value)).toContain("owner")
    expect(roleOptionsFor("admin").map((o) => o.value)).not.toContain("owner")
  })
})

describe("memberRowGate", () => {
  const base = { actorRole: "owner" as const, actorUserId: "me", ownerCount: 2 }
  it("disables removing yourself", () => {
    const gate = memberRowGate({ ...base, member: { userId: "me", role: "admin", canPublish: true } })
    expect(gate.removeDisabled).toBe(true)
    expect(gate.removeReason).toMatch(/your own/i)
  })
  it("disables demoting/removing the last owner", () => {
    const gate = memberRowGate({ ...base, ownerCount: 1, member: { userId: "o", role: "owner", canPublish: true } })
    expect(gate.roleDisabled).toBe(true)
    expect(gate.removeDisabled).toBe(true)
    expect(gate.roleReason).toMatch(/last owner/i)
  })
  it("stops an admin actor from changing an owner", () => {
    const gate = memberRowGate({ actorRole: "admin", actorUserId: "me", ownerCount: 2, member: { userId: "o", role: "owner", canPublish: true } })
    expect(gate.roleDisabled).toBe(true)
    expect(gate.removeDisabled).toBe(true)
  })
  it("forces canPublish off for a viewer", () => {
    const gate = memberRowGate({ ...base, member: { userId: "v", role: "viewer", canPublish: false } })
    expect(gate.canPublishForced).toBe(true)
  })
})
