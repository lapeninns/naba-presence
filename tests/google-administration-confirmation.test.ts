import { describe, expect, it } from "vitest"
import { administrationAccessRequestSchema } from "@/lib/contracts/google-administration-review"
import { administrationAccessConfirmation } from "@/lib/domain/google-administration-confirmation"

const baseline = { collection: "accounts/first/admins", rows: [{ name: "accounts/first/admins/current", role: "OWNER" }] }
const observation = { observedAt: "2026-09-30T08:00:00.000Z", baseline, acceptedAccount: null }

describe("administration independent postconditions", () => {
  it("confirms a new pending invitation without claiming the invitee has accepted", () => {
    const request = administrationAccessRequestSchema.parse({ operation: "create_admin", payload: { scope: "account", role: "MANAGER", admin: "invite@example.test" } })
    const next = { ...observation, baseline: { ...baseline, rows: [...baseline.rows, { name: "accounts/first/admins/new", admin: "invite@example.test", role: "MANAGER", pendingInvitation: true }] } }
    expect(administrationAccessConfirmation({ request, baseline, observation: next, receipt: null })).toEqual({ confirmed: true, postcondition: "administrator_present", pendingInvitation: true })
    expect(administrationAccessConfirmation({ request, baseline: next.baseline, observation: next, receipt: { name: "accounts/first/admins/new", admin: "invite@example.test" } }).confirmed).toBe(false)
    const wrong = { ...observation, baseline: { ...baseline, rows: [...baseline.rows, { name: "accounts/first/admins/new", admin: "other@example.test", role: "MANAGER", pendingInvitation: true }] } }
    expect(administrationAccessConfirmation({ request, baseline, observation: wrong, receipt: { name: "accounts/first/admins/new", admin: "other@example.test" } }).confirmed).toBe(false)
    expect(administrationAccessConfirmation({ request, baseline, observation: wrong, receipt: { name: "accounts/first/admins/new", admin: "invite@example.test" } }).confirmed).toBe(false)
  })
  it("requires the exact administrator and role after a role change", () => {
    const request = administrationAccessRequestSchema.parse({ operation: "update_admin", payload: { name: "accounts/first/admins/current", role: "MANAGER" } })
    expect(administrationAccessConfirmation({ request, baseline, observation, receipt: null }).confirmed).toBe(false)
    const next = { ...observation, baseline: { ...baseline, rows: [{ name: "accounts/first/admins/current", role: "MANAGER" }] } }
    expect(administrationAccessConfirmation({ request, baseline, observation: next, receipt: null }).postcondition).toBe("administrator_role_changed")
  })
  it("does not confirm deletion from a different collection", () => {
    const request = administrationAccessRequestSchema.parse({ operation: "delete_admin", payload: { name: "accounts/first/admins/current" } })
    const next = { ...observation, baseline: { collection: "accounts/other/admins", rows: [] } }
    expect(administrationAccessConfirmation({ request, baseline, observation: next, receipt: null }).confirmed).toBe(false)
  })
  it.each(["accept_invitation", "decline_invitation"])("distinguishes pending absence from proven account access for %s", (operation) => {
    const request = administrationAccessRequestSchema.parse({ operation, payload: { name: "accounts/first/invitations/invite" } })
    const before = { collection: "accounts/first/invitations", rows: [{ name: "accounts/first/invitations/invite", role: "OWNER", targetAccount: { name: "accounts/destination" } }] }
    const after = { ...observation, baseline: { collection: before.collection, rows: [] } }
    expect(administrationAccessConfirmation({ request, baseline: before, observation: after, receipt: null }).confirmed).toBe(operation === "decline_invitation")
    const proven = { ...after, acceptedAccount: { name: "accounts/destination", role: "OWNER" } }
    expect(administrationAccessConfirmation({ request, baseline: before, observation: proven, receipt: null }).confirmed).toBe(true)
    const different = { ...after, acceptedAccount: { name: "accounts/other", role: "OWNER" } }
    expect(administrationAccessConfirmation({ request, baseline: before, observation: different, receipt: null }).confirmed).toBe(operation === "decline_invitation")
  })
})
