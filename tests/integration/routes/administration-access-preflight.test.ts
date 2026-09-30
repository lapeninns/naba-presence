import { describe, expect, it } from "vitest"
import { administrationHarness } from "../helpers/administration-access"
import { seedMemberUser } from "../helpers/tenant"

const describeDatabase = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
describeDatabase("administration exact review and current authorisation guards", () => {
  const harness = administrationHarness()
  it("rejects an unapproved, wrong-hash or edited execution body before any provider write", async () => {
    const fixture = await harness.fixture()
    const saved = await fixture.review({ operation: "delete_admin", payload: { name: `${fixture.location.googleLocationName}/admins/manager` } })
    const path = `/${saved.changeSet.id}/execute`
    expect((await fixture.request(path, "POST", { expectedPayloadHash: saved.changeSet.payloadHash })).status).toBe(409)
    expect((await fixture.approve(saved)).status).toBe(200)
    const wrong = await fixture.request(path, "POST", { expectedPayloadHash: "0".repeat(64) })
    expect(wrong.status).toBe(409)
    expect(await wrong.json()).toMatchObject({ error: "approval_stale" })
    expect((await fixture.request(path, "POST", { expectedPayloadHash: saved.changeSet.payloadHash, payload: { name: "locations/other/admins/victim" } })).status).toBe(400)
    expect(fixture.writes()).toHaveLength(0)
  })
  it.each(["baseline", "credentials", "policy", "expiry", "requester"] as const)("blocks %s drift after approval", async (drift) => {
    const fixture = await harness.fixture()
    const saved = await fixture.review({ operation: "delete_admin", payload: { name: `${fixture.location.googleLocationName}/admins/manager` } })
    expect((await fixture.approve(saved)).status).toBe(200)
    const database = harness.database()
    if (drift === "baseline") fixture.state.admins[0].role = "OWNER"
    if (drift === "credentials") await database`update google_connection set credential_generation = credential_generation + 1 where id = ${fixture.connection.connectionId}`
    if (drift === "policy") await database`update organisation set require_two_person_approval = true where id = ${fixture.owner.organisationId}`
    if (drift === "expiry") await database`update gbp_change_set set approval_expires_at = now() - interval '1 minute' where id = ${saved.changeSet.id}`
    if (drift === "requester") {
      const retainedOwner = await seedMemberUser(database, { organisationId: fixture.owner.organisationId })
      await database`update member set role = 'owner' where organisation_id = ${fixture.owner.organisationId} and user_id = ${retainedOwner.userId}`
      await database`update member set role = 'member' where organisation_id = ${fixture.owner.organisationId} and user_id = ${fixture.owner.userId}`
    }
    const response = await fixture.request(`/${saved.changeSet.id}/execute`, "POST", { expectedPayloadHash: saved.changeSet.payloadHash })
    expect([403, 409]).toContain(response.status)
    expect(fixture.writes()).toHaveLength(0)
  })
  it("rejects a cross-target identity and primary-owner removal during preview", async () => {
    const fixture = await harness.fixture()
    expect((await fixture.request("", "POST", { operation: "delete_admin", payload: { name: "locations/other/admins/manager" } })).status).toBe(409)
    fixture.state.admins[0].role = "PRIMARY_OWNER"
    const response = await fixture.request("", "POST", { operation: "delete_admin", payload: { name: `${fixture.location.googleLocationName}/admins/manager` } })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: "primary_ownership_transfer_required" })
    expect(fixture.writes()).toHaveLength(0)
  })
  it("requires a separate currently eligible manager when two-person approval is enabled", async () => {
    const fixture = await harness.fixture()
    const database = harness.database()
    await database`update organisation set require_two_person_approval = true where id = ${fixture.owner.organisationId}`
    const saved = await fixture.review({ operation: "delete_admin", payload: { name: `${fixture.location.googleLocationName}/admins/manager` } })
    expect(saved.changeSet.requiresSecondApprover).toBe(true)
    expect((await fixture.approve(saved)).status).toBe(409)
    const manager = await seedMemberUser(database, { organisationId: fixture.owner.organisationId })
    await database`update member set role = 'admin' where organisation_id = ${fixture.owner.organisationId} and user_id = ${manager.userId}`
    expect((await fixture.approve(saved, manager.cookie)).status).toBe(200)
    await database`update member set role = 'viewer' where organisation_id = ${fixture.owner.organisationId} and user_id = ${manager.userId}`
    const response = await fixture.request(`/${saved.changeSet.id}/execute`, "POST", { expectedPayloadHash: saved.changeSet.payloadHash })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: "approval_actor_access_changed" })
    expect(fixture.writes()).toHaveLength(0)
  })
  it.each(["create_admin", "update_admin"] as const)("requires the dedicated primary ownership workflow for %s", async (operation) => {
    const fixture = await harness.fixture()
    const request = operation === "create_admin"
      ? { operation, payload: { scope: "location", admin: "new-owner@example.test", role: "PRIMARY_OWNER" } }
      : { operation, payload: { name: `${fixture.location.googleLocationName}/admins/manager`, role: "PRIMARY_OWNER" } }
    const response = await fixture.request("", "POST", request)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: "primary_ownership_transfer_required" })
    expect(fixture.writes()).toHaveLength(0)
  })
  it.each(["update_admin", "delete_admin"] as const)("protects the last Google owner from %s", async (operation) => {
    const fixture = await harness.fixture()
    fixture.state.admins[0].role = "OWNER"
    const name = `${fixture.location.googleLocationName}/admins/manager`
    const request = operation === "update_admin" ? { operation, payload: { name, role: "MANAGER" } } : { operation, payload: { name } }
    const response = await fixture.request("", "POST", request)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: "last_google_owner_required" })
    expect(fixture.writes()).toHaveLength(0)
  })
})
