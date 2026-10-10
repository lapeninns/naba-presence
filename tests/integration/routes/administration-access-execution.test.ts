import { describe, expect, it } from "vitest"
import { administrationHarness } from "../helpers/administration-access"

const describeDatabase = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
describeDatabase("reviewed administration writes through real standalone routes", () => {
  const harness = administrationHarness()
  it.each(["location", "account"] as const)("invites an administrator at the exact %s target, then reads independently", async (scope) => {
    const fixture = await harness.fixture()
    fixture.state.admins = []
    const saved = await fixture.review({ operation: "create_admin", payload: { scope, admin: "invitee@example.test", role: "MANAGER" } })
    expect(fixture.writes()).toHaveLength(0)
    expect((await fixture.approve(saved)).status).toBe(200)
    const outcome = await fixture.execute(saved)
    expect(outcome).toMatchObject({ executionState: "accepted", confirmationState: "confirmed", pendingInvitation: true, postcondition: "administrator_present" })
    expect(fixture.writes()).toHaveLength(1)
    expect(fixture.writes()[0]).toMatchObject({ method: "POST", body: { admin: "invitee@example.test", role: "MANAGER" } })
    expect(fixture.writes()[0].path).toContain(`${scope === "account" ? fixture.connection.googleAccountName : fixture.location.googleLocationName}/admins`)
    const writeIndex = fixture.calls().findIndex((call) => call.method === "POST")
    expect(fixture.calls().slice(writeIndex + 1).some((call) => call.method === "GET")).toBe(true)
    expect(await fixture.execute(saved)).toMatchObject({ id: outcome.id, idempotent: true })
    expect(fixture.writes()).toHaveLength(1)
    const database = harness.database()
    const [row] = await database`select finished_at, change_set_id, requested_payload from gbp_management_mutation where id = ${outcome.id}`
    expect(row.finished_at).toBeInstanceOf(Date)
    expect(row.change_set_id).toBe(saved.changeSet.id)
    expect(row.requested_payload.request).toEqual(saved.request)
  })
  it.each(["update_admin", "delete_admin"] as const)("confirms %s at the exact existing identity", async (operation) => {
    const fixture = await harness.fixture()
    const name = `${fixture.location.googleLocationName}/admins/manager`
    const saved = await fixture.review(operation === "update_admin" ? { operation, payload: { name, role: "OWNER" } } : { operation, payload: { name } })
    expect((await fixture.approve(saved)).status).toBe(200)
    expect(await fixture.execute(saved)).toMatchObject({ executionState: "accepted", confirmationState: "confirmed", postcondition: operation === "update_admin" ? "administrator_role_changed" : "administrator_absent" })
    expect(fixture.writes()).toHaveLength(1)
    expect(fixture.writes()[0].path).toContain(name)
    if (operation === "update_admin") expect(fixture.writes()[0].path).toContain("updateMask=role")
  })
  it.each(["accept_invitation", "decline_invitation"] as const)("confirms %s without treating invitation disappearance as location access", async (operation) => {
    const fixture = await harness.fixture()
    const name = `${fixture.connection.googleAccountName}/invitations/pending`
    fixture.state.invitations = [{ name, role: "MANAGER", targetAccount: { name: fixture.connection.googleAccountName }, targetType: "ACCOUNT" }]
    const saved = await fixture.review({ operation, payload: { name } })
    expect((await fixture.approve(saved)).status).toBe(200)
    expect(await fixture.execute(saved)).toMatchObject({ executionState: "accepted", confirmationState: "confirmed", postcondition: operation === "accept_invitation" ? "account_access_present" : "invitation_absent" })
    expect(fixture.writes()).toHaveLength(1)
  })
  it("holds a location invitation unresolved when no independent access identity is available", async () => {
    const fixture = await harness.fixture()
    const name = `${fixture.connection.googleAccountName}/invitations/pending`
    fixture.state.invitations = [{ name, role: "MANAGER", targetLocation: { locationName: "A display name", placeId: "fixture-place" }, targetType: "LOCATION" }]
    const saved = await fixture.review({ operation: "accept_invitation", payload: { name } })
    expect((await fixture.approve(saved)).status).toBe(200)
    expect(await fixture.execute(saved)).toMatchObject({ executionState: "accepted", confirmationState: "unresolved", postcondition: "unknown" })
    expect(await fixture.execute(saved, "PATCH")).toMatchObject({ confirmationState: "unresolved" })
    expect(fixture.writes()).toHaveLength(1)
  })
})
