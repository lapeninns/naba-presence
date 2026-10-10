import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { businessInformationResponseSchema } from "@/lib/contracts/location-business-information"
import { gbpMutationResultSchema } from "@/lib/contracts/gbp-management"
import { gbpChangeSetResponseSchema } from "@/lib/contracts/gbp-change-set"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { createTestTenant, destroyTenants, seedGoogleConnection, seedLinkedReview } from "../helpers/tenant"

const describeDatabase = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip

describeDatabase("standalone attribute confirmation", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL ?? "", { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl, GBP_PROFILE_WRITES_ENABLED: "true", PUBLISH_ENABLED: "true" })
  })
  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it.each(["retained", "cleared", "lost-response"] as const)("records independently observed %s attributes", async (scenario) => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    google.reset()
    const name = "attributes/has_wifi"
    let attributes = [{ name, values: [false] }]
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: { name: linked.googleLocationName } }))
    google.respond({ method: "GET", pathIncludes: "/attributes" }, () => ({ status: 200, json: { attributes } }))
    let deprecated = false
    google.respond({ method: "GET", pathIncludes: "/v1/attributes?" }, () => ({ status: 200, json: { attributeMetadata: [{ parent: name, valueType: "BOOL", deprecated }] } }))
    let writes = 0
    google.respond({ method: "PATCH", pathIncludes: "/attributes" }, (call) => {
      writes += 1
      expect(new URL(call.path, google.baseUrl).searchParams.get("attributeMask")).toBe(name)
      expect(call.body).toMatchObject({ attributes: [] })
      if (scenario !== "retained") attributes = []
      return scenario === "lost-response" ? { status: 503, json: { error: { message: "Response unavailable" } } } : { status: 200, json: { attributes: [] } }
    })
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/business-information`
    const headers = { cookie: owner.cookie, "content-type": "application/json" }
    const baselineResponse = await fetch(url, { headers })
    expect(baselineResponse.status).toBe(200)
    const baseline = businessInformationResponseSchema.parse(await baselineResponse.json()).businessInformation
    const reviewed: { id?: string } = {}
    const publish = () => fetch(url, { method: "PATCH", headers, body: JSON.stringify({
      operation: "update_attributes", confirmation: "publish_business_attributes_to_google",
      expectedGoogleHash: baseline.attributesHash, attributeMask: [name], attributes: [], changeSetId: reviewed.id,
    }) })
    if (scenario === "retained") {
      const rejected = await publish()
      expect(rejected.status).toBe(409)
      expect(await rejected.json()).toMatchObject({ error: "approval_required" })
      expect(writes).toBe(0)
    }
    const preview = await fetch(url, { method: "PUT", headers, body: JSON.stringify({ operation: "update_attributes", expectedGoogleHash: baseline.attributesHash, attributeMask: [name], attributes: [] }) })
    expect(preview.status, await preview.clone().text()).toBe(200)
    const change = gbpChangeSetResponseSchema.parse(await preview.json()).changeSet
    const changeSetId = change.id
    reviewed.id = changeSetId
    const unapproved = await publish()
    expect(unapproved.status).toBe(409)
    expect(await unapproved.json()).toMatchObject({ error: "approval_required" })
    expect(writes).toBe(0)
    const approval = await fetch(url, { method: "POST", headers, body: JSON.stringify({ changeSetId, expectedPayloadHash: change.payloadHash, resourceType: "attributes" }) })
    expect(approval.status, await approval.clone().text()).toBe(200)
    if (scenario === "retained") {
      await admin`update organisation set require_two_person_approval = true where id = ${owner.organisationId}`
      const changedPolicy = await publish()
      expect(changedPolicy.status).toBe(409)
      expect(await changedPolicy.json()).toMatchObject({ error: "approval_policy_changed" })
      expect(writes).toBe(0)
      await admin`update organisation set require_two_person_approval = false where id = ${owner.organisationId}`
      await admin`update gbp_change_set set approval_expires_at = now() - interval '1 minute' where id = ${changeSetId}`
      const expired = await publish()
      expect(expired.status).toBe(409)
      expect(await expired.json()).toMatchObject({ error: "approval_expired" })
      expect(writes).toBe(0)
      await admin`update gbp_change_set set approval_expires_at = ${change.expiresAt} where id = ${changeSetId}`
    }
    const tampered = await fetch(url, { method: "PATCH", headers, body: JSON.stringify({ operation: "update_attributes", confirmation: "publish_business_attributes_to_google", expectedGoogleHash: baseline.attributesHash, attributeMask: [name], attributes: [{ name, values: [true] }], changeSetId }) })
    expect(tampered.status).toBe(409)
    expect(await tampered.json()).toMatchObject({ error: "approval_stale" })
    expect(writes).toBe(0)
    deprecated = true
    const retired = await publish()
    expect(retired.status).toBe(409)
    expect(await retired.json()).toMatchObject({ error: "attribute_not_supported" })
    deprecated = false
    const response = await publish()
    expect(response.status, await response.clone().text()).toBe(200)
    const result = gbpMutationResultSchema.parse(await response.json())
    const confirmation = scenario === "retained" ? "unresolved" : "confirmed"
    const execution = scenario === "lost-response" ? "unknown" : "accepted"
    expect(result).toMatchObject({ status: scenario === "retained" ? "ambiguous" : "succeeded", executionState: execution, confirmationState: confirmation })
    expect(writes).toBe(1)
    const repeatedPublish = await publish()
    expect(repeatedPublish.status).toBe(200)
    expect(await repeatedPublish.json()).toMatchObject({ id: result.id, idempotent: true })
    expect(writes).toBe(1)
    const [attempt] = await admin`select execution_state, confirmation_state, confirmation_response, confirmation_error_code from gbp_management_mutation where id = ${result.id}`
    expect(attempt).toMatchObject({ execution_state: execution, confirmation_state: confirmation, confirmation_response: { attributes }, confirmation_error_code: scenario === "retained" ? "google_readback_mismatch" : null })
    if (scenario === "retained") {
      const outsider = await createTestTenant(admin)
      organisations.push(outsider.organisationId)
      const foreign = await fetch(url, { method: "POST", headers: { ...headers, cookie: outsider.cookie }, body: JSON.stringify({ mutationId: result.id }) })
      expect([403, 404]).toContain(foreign.status)
      const nextPreview = await fetch(url, { method: "PUT", headers, body: JSON.stringify({ operation: "update_attributes", expectedGoogleHash: baseline.attributesHash, attributeMask: [name], attributes: [] }) })
      const nextChange = gbpChangeSetResponseSchema.parse(await nextPreview.json()).changeSet
      const nextApproval = await fetch(url, { method: "POST", headers, body: JSON.stringify({ changeSetId: nextChange.id, expectedPayloadHash: nextChange.payloadHash, resourceType: "attributes" }) })
      expect(nextApproval.status).toBe(200)
      const blocked = await fetch(url, { method: "PATCH", headers, body: JSON.stringify({
        operation: "update_attributes", confirmation: "publish_business_attributes_to_google",
        expectedGoogleHash: baseline.attributesHash, attributeMask: [name], attributes: [], changeSetId: nextChange.id,
      }) })
      expect(blocked.status).toBe(409)
      expect(await blocked.json()).toMatchObject({ error: "google_confirmation_unresolved" })
      const check = () => fetch(url, { method: "POST", headers, body: JSON.stringify({ mutationId: result.id }) })
      const unresolved = await check()
      expect(unresolved.status).toBe(200)
      expect(await unresolved.json()).toMatchObject({ confirmationState: "unresolved" })
      attributes = []
      const recovered = await check()
      expect(recovered.status, await recovered.clone().text()).toBe(200)
      expect(await recovered.json()).toMatchObject({ confirmationState: "confirmed", status: "succeeded" })
      const repeated = await check()
      expect(await repeated.json()).toMatchObject({ confirmationState: "confirmed", idempotent: true })
      expect(writes).toBe(1)
    }
  }, 30_000)
})
