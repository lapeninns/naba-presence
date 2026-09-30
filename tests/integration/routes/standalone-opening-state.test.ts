import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { businessInformationResponseSchema } from "@/lib/contracts/location-business-information"
import { businessInformationPayloadSchema } from "@/lib/domain/business-information"
import { gbpChangeSetResponseSchema } from "@/lib/contracts/gbp-change-set"
import { gbpMutationResultSchema } from "@/lib/contracts/gbp-management"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { createTestTenant, destroyTenants, seedGoogleConnection, seedLinkedReview } from "../helpers/tenant"

const describeDatabase = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip

describeDatabase("standalone opening-state preservation", () => {
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

  it("preserves date precision and provider siblings, then rejects an unconfirmed status", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    const location = { name: linked.googleLocationName, title: "Opening-state fixture", openInfo: {
      status: "OPEN", openingDate: { year: 2000, month: 3 }, canReopen: true, futureProviderField: "retained",
    } }
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: location }))
    google.respond({ method: "GET", pathIncludes: "/attributes" }, () => ({ status: 200, json: { attributes: [], attributeMetadata: [] } }))
    let writes = 0
    google.respond({ method: "PATCH", pathIncludes: `/v1/${linked.googleLocationName}` }, (call) => {
      const request = new URL(call.path, google.baseUrl)
      expect(request.searchParams.get("updateMask")).toBe("openInfo.status")
      if (request.searchParams.get("validateOnly") !== "true") {
        writes += 1
        if (writes === 1) location.openInfo.status = "CLOSED_TEMPORARILY"
      }
      return { status: 200, json: location }
    })
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/business-information`
    const headers = { cookie: owner.cookie, "content-type": "application/json" }
    const load = async () => {
      const response = await fetch(url, { headers })
      expect(response.status, await response.clone().text()).toBe(200)
      return businessInformationResponseSchema.parse(await response.json()).businessInformation
    }
    const baseline = await load()
    const publish = async (status: string, expectedGoogleHash: string) => {
      const intent = { expectedGoogleHash, updateMask: ["openInfo.status"], payload: { openInfo: { status } } }
      const preview = await fetch(url, { method: "PUT", headers, body: JSON.stringify(intent) })
      const change = gbpChangeSetResponseSchema.parse(await preview.json()).changeSet
      const approved = await fetch(url, { method: "POST", headers, body: JSON.stringify({ changeSetId: change.id, expectedPayloadHash: change.payloadHash }) })
      expect(approved.status).toBe(200)
      return fetch(url, { method: "PATCH", headers,
        body: JSON.stringify({ ...intent, operation: "update_location", confirmation: "publish_business_information_to_google", changeSetId: change.id }),
      })
    }
    const unreviewed = await fetch(url, { method: "PATCH", headers, body: JSON.stringify({ operation: "update_location", confirmation: "publish_business_information_to_google", expectedGoogleHash: baseline.locationHash, updateMask: ["openInfo.status"], payload: { openInfo: { status: "CLOSED_TEMPORARILY" } } }) })
    expect(unreviewed.status).toBe(409)
    expect(await unreviewed.json()).toMatchObject({ error: "approval_required" })
    expect(writes).toBe(0)
    const closed = await publish("CLOSED_TEMPORARILY", baseline.locationHash)
    expect(closed.status, await closed.clone().text()).toBe(200)
    expect(await closed.json()).toMatchObject({ status: "succeeded" })
    expect((await load()).location.openInfo).toEqual({
      status: "CLOSED_TEMPORARILY", openingDate: { year: 2000, month: 3 }, canReopen: true, futureProviderField: "retained",
    })
    const current = await load()
    const unconfirmed = await publish("OPEN", current.locationHash)
    expect(unconfirmed.status).toBe(200)
    expect(await unconfirmed.json()).toMatchObject({ status: "ambiguous", confirmationState: "unresolved" })
    expect(writes).toBe(2)
  }, 30_000)

  it("sets a partial date and confirms clearing only after independent readback", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    let openingDate: { year: number; month: number; day?: number } | undefined = { year: 2000, month: 3, day: 1 }
    const snapshot = () => ({ name: linked.googleLocationName, openInfo: { status: "CLOSED_TEMPORARILY", canReopen: true, openingDate } })
    google.reset()
    google.respond({ method: "GET", pathIncludes: "/attributes" }, () => ({ status: 200, json: { attributes: [], attributeMetadata: [] } }))
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: snapshot() }))
    let writes = 0
    google.respond({ method: "PATCH", pathIncludes: `/v1/${linked.googleLocationName}` }, (call) => {
      const request = new URL(call.path, google.baseUrl)
      expect(request.searchParams.get("updateMask")).toBe("openInfo.openingDate")
      if (request.searchParams.get("validateOnly") !== "true") {
        writes += 1
        const payload = businessInformationPayloadSchema.strip().parse(call.body)
        if (writes !== 2) openingDate = payload.openInfo?.openingDate
      }
      return { status: 200, json: snapshot() }
    })
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/business-information`
    const headers = { cookie: owner.cookie, "content-type": "application/json" }
    for (const [index, date] of [{ year: 2001, month: 4 }, undefined].entries()) {
      const read = await fetch(url, { headers })
      const baseline = businessInformationResponseSchema.parse(await read.json()).businessInformation
      const intent = {
        expectedGoogleHash: baseline.locationHash, updateMask: ["openInfo.openingDate"],
        payload: { openInfo: { status: "CLOSED_TEMPORARILY", openingDate: date } },
      }
      const preview = await fetch(url, { method: "PUT", headers, body: JSON.stringify(intent) })
      expect(preview.status, await preview.clone().text()).toBe(200)
      const change = gbpChangeSetResponseSchema.parse(await preview.json()).changeSet
      const approved = await fetch(url, { method: "POST", headers, body: JSON.stringify({ changeSetId: change.id, expectedPayloadHash: change.payloadHash }) })
      expect(approved.status, await approved.clone().text()).toBe(200)
      const response = await fetch(url, { method: "PATCH", headers, body: JSON.stringify({ ...intent,
        operation: "update_location", confirmation: "publish_business_information_to_google", changeSetId: change.id,
      }) })
      expect(response.status, await response.clone().text()).toBe(200)
      const result = gbpMutationResultSchema.parse(await response.json())
      expect(result.confirmationState).toBe(index === 1 ? "unresolved" : "confirmed")
      if (index === 1) {
        openingDate = undefined
        const recovered = await fetch(url, { method: "POST", headers, body: JSON.stringify({ mutationId: result.id }) })
        expect(recovered.status, await recovered.clone().text()).toBe(200)
        expect(await recovered.json()).toMatchObject({ status: "succeeded", confirmationState: "confirmed" })
      }
      expect(snapshot().openInfo).toMatchObject({ status: "CLOSED_TEMPORARILY", canReopen: true })
    }
    expect(openingDate).toBeUndefined()
    expect(writes).toBe(2)
  }, 30_000)
})
