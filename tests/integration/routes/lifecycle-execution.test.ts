import { describe, expect, it } from "vitest"
import { z } from "zod"
import { gbpChangeSetSchema } from "@/lib/contracts/gbp-change-set"
import { googleLifecycleRequestSchema, type GoogleLifecycleRequest } from "@/lib/contracts/google-lifecycle"
import { lifecycleHarness } from "../helpers/google-lifecycle"
import { seedGoogleConnection } from "../helpers/tenant"

const describeDatabase = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
const reviewResponse = z.object({ review: z.object({ changeSet: gbpChangeSetSchema, request: googleLifecycleRequestSchema }) })
const attemptResponse = z.object({ attempt: z.object({ executionState: z.string(), confirmationState: z.string(), postcondition: z.string(), idempotent: z.boolean() }) })
describeDatabase("reviewed Google location lifecycle execution", { timeout: 30_000 }, () => {
  const harness = lifecycleHarness()
  async function reviewed(fixture: Awaited<ReturnType<typeof harness.fixture>>, request: GoogleLifecycleRequest) {
    const response = await fixture.request("", "POST", request)
    expect(response.status).toBe(200)
    return reviewResponse.parse(await response.json()).review
  }
  it("reviews and separately approves an exact transfer before one provider write and independent account readback", async () => {
    const fixture = await harness.fixture()
    const saved = await reviewed(fixture, { operation: "transfer_location", payload: { destinationAccount: fixture.destinationAccount } })
    expect(saved.changeSet.targetResourceName).toBe(fixture.linked.googleLocationName)
    expect(fixture.writes()).toHaveLength(0)
    const body = { expectedPayloadHash: saved.changeSet.payloadHash }
    expect((await fixture.request(`/${saved.changeSet.id}/execute`, "POST", body)).status).toBe(409)
    expect((await fixture.request(`/${saved.changeSet.id}`, "POST", body)).status).toBe(200)
    expect(fixture.writes()).toHaveLength(0)
    const response = await fixture.request(`/${saved.changeSet.id}/execute`, "POST", body)
    expect(response.status).toBe(200)
    expect(attemptResponse.parse(await response.json()).attempt).toMatchObject({ executionState: "accepted", confirmationState: "confirmed", postcondition: "location_transferred_between_accounts" })
    expect(fixture.writes()).toHaveLength(1)
    expect(fixture.writes()[0].body).toEqual({ destinationAccount: fixture.destinationAccount })
    const [mapped] = await harness.database()`select google_account_name from external_location where google_location_name = ${fixture.linked.googleLocationName}`
    expect(mapped.google_account_name).toBe(fixture.destinationAccount)
    const refreshed = await fixture.request(`/${saved.changeSet.id}/execute`, "PATCH", {})
    expect(refreshed.status).toBe(200)
    expect(await refreshed.json()).toMatchObject({ attempt: { sourceAccount: fixture.connection.googleAccountName, localReconciliation: "applied", confirmationState: "confirmed" } })
    const repeated = await fixture.request(`/${saved.changeSet.id}/execute`, "POST", body)
    expect(repeated.status).toBe(200)
    expect(attemptResponse.parse(await repeated.json()).attempt.idempotent).toBe(true)
    expect(fixture.writes()).toHaveLength(1)
  })
  it("confirms only managed-account absence for an approved deletion", async () => {
    const fixture = await harness.fixture()
    const saved = await reviewed(fixture, { operation: "delete_location", payload: {} })
    const body = { expectedPayloadHash: saved.changeSet.payloadHash }
    expect((await fixture.request(`/${saved.changeSet.id}`, "POST", body)).status).toBe(200)
    const response = await fixture.request(`/${saved.changeSet.id}/execute`, "POST", body)
    expect(response.status).toBe(200)
    expect(attemptResponse.parse(await response.json()).attempt).toMatchObject({ executionState: "accepted", confirmationState: "confirmed", postcondition: "location_absent_from_managed_account" })
    expect(fixture.writes()).toHaveLength(1)
    expect(fixture.writes()[0].method).toBe("DELETE")
    expect(fixture.writes()[0].path).toMatch(new RegExp(`${fixture.linked.googleLocationName}$`))
  })
  it("keeps provider confirmation separate from a conflicting local destination binding and reconciles by reads only", async () => {
    const fixture = await harness.fixture(), database = harness.database()
    const other = await seedGoogleConnection(database, { organisationId: fixture.owner.organisationId })
    await database`insert into google_account (organisation_id, google_connection_id, google_account_name, role, is_active)
      values (${fixture.owner.organisationId}, ${other.connectionId}, ${fixture.destinationAccount}, 'MANAGER', true)`
    const saved = await reviewed(fixture, { operation: "transfer_location", payload: { destinationAccount: fixture.destinationAccount } })
    const body = { expectedPayloadHash: saved.changeSet.payloadHash }
    expect((await fixture.request(`/${saved.changeSet.id}`, "POST", body)).status).toBe(200)
    const executed = await fixture.request(`/${saved.changeSet.id}/execute`, "POST", body)
    expect(executed.status).toBe(200)
    expect(await executed.json()).toMatchObject({ attempt: { confirmationState: "confirmed", localReconciliation: "conflict" } })
    const [linked] = await database`select google_account_name from external_location where google_location_name = ${fixture.linked.googleLocationName}`
    expect(linked.google_account_name).toBe(fixture.connection.googleAccountName)
    await database`delete from google_account where google_account_name = ${fixture.destinationAccount} and google_connection_id = ${other.connectionId}`
    const refreshed = await fixture.request(`/${saved.changeSet.id}/execute`, "PATCH", {})
    expect(refreshed.status).toBe(200)
    expect(await refreshed.json()).toMatchObject({ attempt: { confirmationState: "confirmed", localReconciliation: "applied", sourceAccount: fixture.connection.googleAccountName } })
    expect(fixture.writes()).toHaveLength(1)
  })
  it("retains unknown acknowledgement when an ambiguous transfer is independently confirmed", async () => {
    const fixture = await harness.fixture()
    const saved = await reviewed(fixture, { operation: "transfer_location", payload: { destinationAccount: fixture.destinationAccount } })
    const body = { expectedPayloadHash: saved.changeSet.payloadHash }
    expect((await fixture.request(`/${saved.changeSet.id}`, "POST", body)).status).toBe(200)
    fixture.state.writeStatus = 503
    const response = await fixture.request(`/${saved.changeSet.id}/execute`, "POST", body)
    expect(response.status).toBe(200)
    expect(attemptResponse.parse(await response.json()).attempt).toMatchObject({ executionState: "unknown", confirmationState: "confirmed", postcondition: "location_transferred_between_accounts" })
    expect(fixture.writes()).toHaveLength(1)
  })
  it("blocks an expired approved lifecycle review before any provider write", async () => {
    const fixture = await harness.fixture()
    const saved = await reviewed(fixture, { operation: "delete_location", payload: {} })
    const body = { expectedPayloadHash: saved.changeSet.payloadHash }
    expect((await fixture.request(`/${saved.changeSet.id}`, "POST", body)).status).toBe(200)
    await harness.database()`update gbp_change_set set approval_expires_at = now() - interval '1 minute' where id = ${saved.changeSet.id}`
    expect((await fixture.request(`/${saved.changeSet.id}/execute`, "POST", body)).status).toBe(409)
    expect(fixture.writes()).toHaveLength(0)
  })
  it("blocks changed credential generation after approval without sending the reviewed transfer", async () => {
    const fixture = await harness.fixture()
    const saved = await reviewed(fixture, { operation: "transfer_location", payload: { destinationAccount: fixture.destinationAccount } })
    const body = { expectedPayloadHash: saved.changeSet.payloadHash }
    expect((await fixture.request(`/${saved.changeSet.id}`, "POST", body)).status).toBe(200)
    await harness.database()`update google_connection set credential_generation = credential_generation + 1 where id = ${fixture.connection.connectionId}`
    expect((await fixture.request(`/${saved.changeSet.id}/execute`, "POST", body)).status).toBe(409)
    expect(fixture.writes()).toHaveLength(0)
  })
  it("blocks changed destination access and leaves the source location intact", async () => {
    const fixture = await harness.fixture()
    const saved = await reviewed(fixture, { operation: "transfer_location", payload: { destinationAccount: fixture.destinationAccount } })
    const body = { expectedPayloadHash: saved.changeSet.payloadHash }
    expect((await fixture.request(`/${saved.changeSet.id}`, "POST", body)).status).toBe(200)
    fixture.state.destinationRole = "SITE_MANAGER"
    const blocked = await fixture.request(`/${saved.changeSet.id}/execute`, "POST", body)
    expect(blocked.status).toBe(409)
    expect(await blocked.json()).toMatchObject({ error: "google_destination_changed" })
    expect(fixture.writes()).toHaveLength(0)
    expect(fixture.state.source.map((location) => location.name)).toEqual([fixture.linked.googleLocationName])
  })
  it("restores a dated deletion outcome after expiry and disconnection without another Google call", async () => {
    const fixture = await harness.fixture()
    const saved = await reviewed(fixture, { operation: "delete_location", payload: {} })
    const body = { expectedPayloadHash: saved.changeSet.payloadHash }
    expect((await fixture.request(`/${saved.changeSet.id}`, "POST", body)).status).toBe(200)
    expect((await fixture.request(`/${saved.changeSet.id}/execute`, "POST", body)).status).toBe(200)
    await harness.database()`update gbp_change_set set approval_expires_at = now() - interval '1 hour' where id = ${saved.changeSet.id}`
    await harness.database()`update google_connection set status = 'disconnected' where id = ${fixture.connection.connectionId}`
    const calls = fixture.calls().length
    const response = await fixture.request(`/${saved.changeSet.id}/execute`)
    expect(response.status).toBe(200)
    expect(attemptResponse.parse(await response.json()).attempt).toMatchObject({ executionState: "accepted", confirmationState: "confirmed", postcondition: "location_absent_from_managed_account" })
    expect(fixture.calls()).toHaveLength(calls)
    expect(fixture.writes()).toHaveLength(1)
  })
  it("keeps deletion unresolved when the independent location read is forbidden", async () => {
    const fixture = await harness.fixture()
    const saved = await reviewed(fixture, { operation: "delete_location", payload: {} })
    const body = { expectedPayloadHash: saved.changeSet.payloadHash }
    expect((await fixture.request(`/${saved.changeSet.id}`, "POST", body)).status).toBe(200)
    fixture.state.afterDeleteReadStatus = 403
    const response = await fixture.request(`/${saved.changeSet.id}/execute`, "POST", body)
    expect(response.status).toBe(200)
    expect(attemptResponse.parse(await response.json()).attempt).toMatchObject({ executionState: "accepted", confirmationState: "unresolved", postcondition: "unresolved" })
    expect(fixture.writes()).toHaveLength(1)
  })
})
