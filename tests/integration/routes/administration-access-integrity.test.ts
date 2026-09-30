import postgres from "postgres"
import { describe, expect, it } from "vitest"
import { administrationAccessReviewResponseSchema } from "@/lib/contracts/google-administration-review"
import { administrationHarness } from "../helpers/administration-access"
import { seedLinkedLocation } from "../helpers/tenant"

const describeDatabase = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
describeDatabase("administration persisted intent isolation and account serialisation", () => {
  const harness = administrationHarness()
  it("serialises writes across two locations in the same Google account", async () => {
    const fixture = await harness.fixture()
    const database = harness.database()
    const secondLocation = await seedLinkedLocation(database, { organisationId: fixture.owner.organisationId, ...fixture.connection })
    const secondName = `${fixture.connection.googleAccountName}/invitations/pending`
    fixture.state.invitations = [{ name: secondName, role: "MANAGER", targetAccount: { name: fixture.connection.googleAccountName } }]
    const saved = await fixture.review({ operation: "delete_admin", payload: { name: `${fixture.location.googleLocationName}/admins/manager` } })
    expect((await fixture.approve(saved)).status).toBe(200)
    const origin = new URL((await fixture.request("")).url).origin
    const root = `${origin}/api/locations/${secondLocation.locationId}/administration-access-reviews`
    const response = await fetch(root, { method: "POST", headers: { cookie: fixture.owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ operation: "decline_invitation", payload: { name: secondName } }) })
    expect(response.status).toBe(200)
    const second = administrationAccessReviewResponseSchema.parse(await response.json()).review
    expect((await fetch(`${root}/${second.changeSet.id}`, { method: "POST", headers: { cookie: fixture.owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ expectedPayloadHash: second.changeSet.payloadHash }) })).status).toBe(200)
    fixture.state.delayMs = 500
    const first = fixture.execute(saved)
    await expect.poll(() => fixture.writes().length).toBe(1)
    const collision = await fetch(`${root}/${second.changeSet.id}/execute`, { method: "POST", headers: { cookie: fixture.owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ expectedPayloadHash: second.changeSet.payloadHash }) })
    expect(collision.status).toBe(409)
    expect(await collision.json()).toMatchObject({ error: "administration_in_progress" })
    expect(await first).toMatchObject({ confirmationState: "confirmed" })
    expect(fixture.writes()).toHaveLength(1)
  })
  it("keeps reviewed payload, baseline and target immutable for the runtime role and isolated from another tenant", async () => {
    const fixture = await harness.fixture()
    const saved = await fixture.review({ operation: "delete_admin", payload: { name: `${fixture.location.googleLocationName}/admins/manager` } })
    const runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, { max: 1 })
    try {
      for (const column of ["payload", "baseline", "target_resource_name"]) {
        await expect(runtime.begin(async (sql) => {
          await sql`select set_config('app.organisation_id', ${fixture.owner.organisationId}, true)`
          await sql`update gbp_change_set set ${sql(column)} = ${sql(column)} where id = ${saved.changeSet.id}`
        })).rejects.toMatchObject({ code: "42501" })
      }
      await runtime.begin(async (sql) => {
        await sql`select set_config('app.organisation_id', '00000000-0000-0000-0000-000000000000', true)`
        expect(await sql`select id from gbp_change_set where id = ${saved.changeSet.id}`).toHaveLength(0)
      })
    } finally { await runtime.end() }
    expect(fixture.writes()).toHaveLength(0)
  })
  it("recovers a stale interrupted claim using an independent read without sending the operation again", async () => {
    const fixture = await harness.fixture()
    const saved = await fixture.review({ operation: "update_admin", payload: { name: `${fixture.location.googleLocationName}/admins/manager`, role: "OWNER" } })
    expect((await fixture.approve(saved)).status).toBe(200)
    const outcome = await fixture.execute(saved)
    const database = harness.database()
    await database`update gbp_management_mutation set status = 'started', execution_state = 'pending', confirmation_state = 'pending', confirmation_response = null, created_at = now() where id = ${outcome.id}`
    const waiting = await fixture.request(`/${saved.changeSet.id}/execute`, "PATCH", {})
    expect(waiting.status).toBe(409)
    expect(await waiting.json()).toMatchObject({ error: "administration_not_ready" })
    await database`update gbp_management_mutation set created_at = now() - interval '6 minutes' where id = ${outcome.id}`
    expect(await fixture.execute(saved, "PATCH")).toMatchObject({ executionState: "unknown", confirmationState: "confirmed", status: "succeeded" })
    expect(fixture.writes()).toHaveLength(1)
  })
})
