import { describe, expect, it } from "vitest"
import { administrationHarness } from "../helpers/administration-access"

const describeDatabase = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
describeDatabase("administration acknowledgement and independent outcome recovery", () => {
  const harness = administrationHarness()
  it("confirms the applied role after a lost receipt without upgrading the unknown acknowledgement or resending", async () => {
    const fixture = await harness.fixture()
    const saved = await fixture.review({ operation: "update_admin", payload: { name: `${fixture.location.googleLocationName}/admins/manager`, role: "OWNER" } })
    expect((await fixture.approve(saved)).status).toBe(200)
    fixture.state.writeStatus = 503
    const outcome = await fixture.execute(saved)
    expect(outcome).toMatchObject({ executionState: "unknown", confirmationState: "confirmed", status: "succeeded", postcondition: "administrator_role_changed" })
    expect(await fixture.execute(saved)).toMatchObject({ id: outcome.id, executionState: "unknown", confirmationState: "confirmed", idempotent: true })
    expect(await fixture.execute(saved, "PATCH")).toMatchObject({ id: outcome.id, executionState: "unknown", confirmationState: "confirmed" })
    expect(fixture.writes()).toHaveLength(1)
  })
  it("blocks another reviewed write while the original outcome is unknown, then only reads during recovery", async () => {
    const fixture = await harness.fixture()
    const name = `${fixture.location.googleLocationName}/admins/manager`
    const first = await fixture.review({ operation: "update_admin", payload: { name, role: "OWNER" } })
    const second = await fixture.review({ operation: "delete_admin", payload: { name } })
    expect((await fixture.approve(first)).status).toBe(200)
    expect((await fixture.approve(second)).status).toBe(200)
    fixture.state.writeStatus = 503
    fixture.state.applyWrite = false
    expect(await fixture.execute(first)).toMatchObject({ executionState: "unknown", confirmationState: "unresolved" })
    const blocked = await fixture.request(`/${second.changeSet.id}/execute`, "POST", { expectedPayloadHash: second.changeSet.payloadHash })
    expect(blocked.status).toBe(409)
    expect(await blocked.json()).toMatchObject({ error: "google_confirmation_unresolved" })
    fixture.state.readStatus = 503
    expect(await fixture.execute(first, "PATCH")).toMatchObject({ confirmationState: "unresolved", error: "refresh_unavailable" })
    fixture.state.readStatus = 200
    fixture.state.admins[0].role = "OWNER"
    expect(await fixture.execute(first, "PATCH")).toMatchObject({ executionState: "unknown", confirmationState: "confirmed" })
    expect(fixture.writes()).toHaveLength(1)
  }, 20_000)
  it("finishes a definitive rejection and requires a new reviewed intent for a correction", async () => {
    const fixture = await harness.fixture()
    const request = { operation: "create_admin", payload: { scope: "location", admin: "new@example.test", role: "MANAGER" } } as const
    const saved = await fixture.review(request)
    expect((await fixture.approve(saved)).status).toBe(200)
    fixture.state.writeStatus = 400
    fixture.state.applyWrite = false
    const rejected = await fixture.execute(saved)
    expect(rejected).toMatchObject({ executionState: "rejected", confirmationState: "unrecorded", status: "failed", error: "provider_rejected" })
    const database = harness.database()
    const [row] = await database`select finished_at from gbp_management_mutation where id = ${rejected.id}`
    expect(row.finished_at).toBeInstanceOf(Date)
    expect(await fixture.execute(saved, "PATCH")).toMatchObject({ id: rejected.id, executionState: "rejected" })
    fixture.state.writeStatus = 200
    fixture.state.applyWrite = true
    const corrected = await fixture.review(request)
    expect((await fixture.approve(corrected)).status).toBe(200)
    expect(await fixture.execute(corrected)).toMatchObject({ executionState: "accepted", confirmationState: "confirmed" })
    expect(fixture.writes()).toHaveLength(2)
  })
})
