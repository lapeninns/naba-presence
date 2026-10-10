import { describe, expect, it } from "vitest"
import { administrationAccessRequestSchema } from "@/lib/contracts/google-administration-review"
import { administrationAccessTarget } from "@/lib/domain/google-administration"

const linked = { accountName: "accounts/first", googleLocationName: "locations/first" }

describe("typed exact Google administration target", () => {
  it.each(["accounts/first/admins/person", "locations/first/admins/person"])("accepts exact linked administrator %s", (name) => {
    const request = administrationAccessRequestSchema.parse({ operation: "update_admin", payload: { name, role: "MANAGER" } })
    expect(administrationAccessTarget(request, linked).target).toBe(name)
  })
  it.each(["accounts/other/admins/person", "locations/other/admins/person", "locations/first-extra/admins/person"])("rejects cross-target administrator %s", (name) => {
    const request = administrationAccessRequestSchema.parse({ operation: "delete_admin", payload: { name } })
    expect(() => administrationAccessTarget(request, linked)).toThrow("outside this listing's linked Google target")
  })
  it.each(["locations/first/admins/person?alt=json", "locations/first/admins/../person", "locations/first/admins/person:delete", "locations/first/admins/person%2Fother"])("rejects provider-path injection %s", (name) => {
    expect(administrationAccessRequestSchema.safeParse({ operation: "delete_admin", payload: { name } }).success).toBe(false)
  })
  it("binds an invitation to the exact linked account", () => {
    const request = administrationAccessRequestSchema.parse({ operation: "accept_invitation", payload: { name: "accounts/first/invitations/invite" } })
    expect(administrationAccessTarget(request, linked)).toMatchObject({ parent: "accounts/first", target: "accounts/first/invitations/invite", resourceType: "invitation" })
    expect(() => administrationAccessTarget(request, { ...linked, accountName: "accounts/other" })).toThrow("outside this listing's linked Google account")
  })
  it("keeps email and location-group invitees mutually exclusive", () => {
    expect(administrationAccessRequestSchema.safeParse({ operation: "create_admin", payload: { scope: "location", role: "OWNER", admin: "person@example.test", account: "accounts/group" } }).success).toBe(false)
    expect(administrationAccessRequestSchema.safeParse({ operation: "create_admin", payload: { scope: "location", role: "OWNER" } }).success).toBe(false)
    const request = administrationAccessRequestSchema.parse({ operation: "create_admin", payload: { scope: "location", role: "MANAGER", account: "accounts/group" } })
    expect(administrationAccessTarget(request, linked)).toMatchObject({ parent: "locations/first", resourceType: "location_admin" })
  })
  it("rejects output/unknown fields and documented unsupported account invitations", () => {
    expect(administrationAccessRequestSchema.safeParse({ operation: "create_admin", payload: { scope: "account", role: "SITE_MANAGER", admin: "person@example.test" } }).success).toBe(false)
    expect(administrationAccessRequestSchema.safeParse({ operation: "create_admin", payload: { scope: "account", role: "MANAGER", account: "accounts/group" } }).success).toBe(false)
    expect(administrationAccessRequestSchema.safeParse({ operation: "update_admin", payload: { name: "accounts/first/admins/person", role: "OWNER", pendingInvitation: false } }).success).toBe(false)
    expect(administrationAccessRequestSchema.safeParse({ operation: "update_admin", payload: { name: "accounts/first/admins/person", role: "FUTURE_ROLE" } }).success).toBe(false)
  })
})
