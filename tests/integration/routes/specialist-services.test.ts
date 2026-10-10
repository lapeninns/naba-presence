import { describe, expect, it } from "vitest"
import { lifecycleHarness } from "../helpers/google-lifecycle"
import { industryResponseSchema } from "@/lib/contracts/location-industry"
import { gbpChangeSetResponseSchema } from "@/lib/contracts/gbp-change-set"
import { serviceAttemptResponseSchema } from "@/lib/contracts/service-attempt"
import { serviceWorkflowsResponseSchema } from "@/lib/contracts/service-workflows"
import { stableGoogleHash } from "@/lib/server/gbp-management"

const describeDatabase = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
describeDatabase("specialist services converge on the reviewed general editor", { timeout: 30_000 }, () => {
  const harness = lifecycleHarness()
  it("records a reviewed service write and restores its dated outcome after disconnection without another provider request", async () => {
    const fixture = await harness.fixture()
    const location = { name: fixture.linked.googleLocationName, metadata: { canModifyServiceList: true }, serviceItems: [] }
    fixture.provider.respond({ method: "GET", pathIncludes: `/v1/${fixture.linked.googleLocationName}?` }, () => ({ status: 200, json: location }))
    fixture.provider.respond({ method: "PATCH", pathIncludes: `/v1/${fixture.linked.googleLocationName}?` }, () => ({ status: 200, json: location }))
    const url = `${fixture.baseUrl}/api/locations/${fixture.linked.locationId}/business-information`
    const headers = { cookie: fixture.owner.cookie, "content-type": "application/json" }
    const body = { expectedGoogleHash: stableGoogleHash(location), payload: { serviceItems: [] }, updateMask: ["serviceItems"] }
    const preview = await fetch(url, { method: "PUT", headers, body: JSON.stringify(body) })
    expect(preview.status, await preview.clone().text()).toBe(200)
    const change = gbpChangeSetResponseSchema.parse(await preview.json()).changeSet
    const approval = await fetch(url, { method: "POST", headers, body: JSON.stringify({ changeSetId: change.id, expectedPayloadHash: change.payloadHash }) })
    expect(approval.status).toBe(200)
    expect(fixture.provider.calls.filter((call) => call.method === "PATCH")).toHaveLength(0)
    const sent = await fetch(url, { method: "PATCH", headers, body: JSON.stringify({ ...body, changeSetId: change.id, operation: "update_location", confirmation: "publish_business_information_to_google" }) })
    expect(sent.status, await sent.clone().text()).toBe(200)
    expect(await sent.json()).toMatchObject({ executionState: "accepted", confirmationState: "confirmed" })
    await harness.database()`update google_connection set status = 'disconnected' where id = ${fixture.connection.connectionId}`
    const beforeRead = fixture.provider.calls.length
    const restored = await fetch(`${url}?type=service_attempt&changeSetId=${change.id}`, { headers })
    expect(restored.status, await restored.clone().text()).toBe(200)
    const attempt = serviceAttemptResponseSchema.parse(await restored.json()).attempt
    expect(attempt).toMatchObject({ reviewId: change.id, targetResourceName: fixture.linked.googleLocationName, executionState: "accepted", confirmationState: "confirmed" })
    expect(attempt.observedAt).not.toBeNull()
    const index = await fetch(`${url}?type=service_workflows`, { headers })
    expect(index.status, await index.clone().text()).toBe(200)
    expect(serviceWorkflowsResponseSchema.parse(await index.json()).items).toMatchObject([{ changeSet: { id: change.id }, attemptId: attempt.id }])
    expect(fixture.provider.calls).toHaveLength(beforeRead)
  })
  it("rejects an unreviewed general service write before reading Google", async () => {
    const fixture = await harness.fixture()
    const response = await fetch(`${fixture.baseUrl}/api/locations/${fixture.linked.locationId}/business-information`, {
      method: "PATCH", headers: { cookie: fixture.owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ operation: "update_location", confirmation: "publish_business_information_to_google", updateMask: ["serviceItems"], expectedGoogleHash: "a".repeat(64), payload: { serviceItems: [] } }),
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: "service_review_required" })
    expect(fixture.provider.calls).toHaveLength(0)
  })
  it("reads a missing saved service attempt without contacting Google", async () => {
    const fixture = await harness.fixture()
    const response = await fetch(`${fixture.baseUrl}/api/locations/${fixture.linked.locationId}/business-information?type=service_attempt&changeSetId=11111111-1111-4111-8111-111111111111`, { headers: { cookie: fixture.owner.cookie } })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: "service_attempt_not_found" })
    expect(fixture.provider.calls).toHaveLength(0)
  })
  it("rejects the legacy arbitrary healthcare service writer before any provider request", async () => {
    const fixture = await harness.fixture()
    fixture.provider.respond({ method: "PATCH", pathIncludes: "/serviceList?" }, () => ({ status: 200, json: { serviceItems: [] } }))
    const response = await fetch(`${fixture.baseUrl}/api/locations/${fixture.linked.locationId}/industry`, {
      method: "PATCH", headers: { cookie: fixture.owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ operation: "update_healthcare_services", confirmation: "publish_industry_data_to_google", updateMask: ["serviceItems"], payload: { serviceItems: [] } }),
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: "service_review_required" })
    expect(fixture.provider.calls).toHaveLength(0)
  })
  it("does not load a parallel healthcare service model while reading lodging", async () => {
    const fixture = await harness.fixture()
    fixture.provider.respond({ method: "GET", pathIncludes: "/lodging" }, () => ({ status: 200, json: { pets: { petsAllowed: false } } }))
    fixture.provider.respond({ method: "GET", pathEndsWith: "/serviceList" }, () => ({ status: 200, json: { serviceItems: [{ freeFormServiceItem: { categoryId: "gcid:doctor", label: { displayName: "Consultation" } } }] } }))
    const response = await fetch(`${fixture.baseUrl}/api/locations/${fixture.linked.locationId}/industry`, { headers: { cookie: fixture.owner.cookie } })
    expect(response.status).toBe(200)
    const state = industryResponseSchema.parse(await response.json()).industry
    expect(state.healthcareServices).toEqual({ data: null, error: null })
    expect(fixture.provider.calls.some((call) => call.path.includes("serviceList"))).toBe(false)
    expect(fixture.provider.calls.some((call) => call.path.includes("healthProviderAttributes") || call.path.includes("insuranceNetworks"))).toBe(false)
  })
})
