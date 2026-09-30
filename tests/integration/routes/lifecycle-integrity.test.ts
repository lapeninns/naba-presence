import postgres from "postgres"
import { describe, expect, it } from "vitest"
import { lifecycleReviewResponseSchema } from "@/lib/contracts/google-lifecycle-review"
import { lifecycleHarness } from "../helpers/google-lifecycle"
import { seedMemberUser } from "../helpers/tenant"

const describeDatabase = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
describeDatabase("lifecycle approval identity and runtime immutability", { timeout: 30_000 }, () => {
  const harness = lifecycleHarness()
  it("requires a different current manager and blocks execution when that approver is revoked", async () => {
    const fixture = await harness.fixture(), database = harness.database()
    await database`update organisation set require_two_person_approval = true where id = ${fixture.owner.organisationId}`
    const response = await fixture.request("", "POST", { operation: "delete_location", payload: {} })
    expect(response.status).toBe(200)
    const review = lifecycleReviewResponseSchema.parse(await response.json()).review
    const body = { expectedPayloadHash: review.changeSet.payloadHash }
    expect((await fixture.request(`/${review.changeSet.id}`, "POST", body)).status).toBe(409)
    const manager = await seedMemberUser(database, { organisationId: fixture.owner.organisationId })
    await database`update member set role = 'admin' where organisation_id = ${fixture.owner.organisationId} and user_id = ${manager.userId}`
    expect((await fixture.request(`/${review.changeSet.id}`, "POST", body, manager.cookie)).status).toBe(200)
    await database`update member set role = 'viewer' where organisation_id = ${fixture.owner.organisationId} and user_id = ${manager.userId}`
    const execute = await fixture.request(`/${review.changeSet.id}/execute`, "POST", body)
    expect(execute.status).toBe(409)
    expect(await execute.json()).toMatchObject({ error: "approval_actor_access_changed" })
    expect(fixture.writes()).toHaveLength(0)
  })
  it("keeps the reviewed payload, baseline and exact target immutable for the forced-RLS runtime role", async () => {
    const fixture = await harness.fixture()
    const response = await fixture.request("", "POST", { operation: "delete_location", payload: {} })
    expect(response.status).toBe(200)
    const review = lifecycleReviewResponseSchema.parse(await response.json()).review
    if (!process.env.TEST_RUNTIME_DATABASE_URL) throw new Error("Isolated runtime database required")
    const runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL, { max: 1 })
    try {
      for (const column of ["payload", "baseline", "target_resource_name", "connection_id"]) {
        await expect(runtime.begin(async (sql) => {
          await sql`select set_config('app.organisation_id', ${fixture.owner.organisationId}, true)`
          await sql`update gbp_change_set set ${sql(column)} = ${sql(column)} where id = ${review.changeSet.id}`
        })).rejects.toMatchObject({ code: "42501" })
      }
      await runtime.begin(async (sql) => {
        await sql`select set_config('app.organisation_id', '00000000-0000-0000-0000-000000000000', true)`
        expect(await sql`select id from gbp_change_set where id = ${review.changeSet.id}`).toHaveLength(0)
      })
    } finally { await runtime.end() }
    expect(fixture.writes()).toHaveLength(0)
  })
})
