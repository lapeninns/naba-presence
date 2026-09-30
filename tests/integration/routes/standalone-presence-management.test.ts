import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { businessInformationResponseSchema } from "@/lib/contracts/location-business-information"
import { industryResponseSchema } from "@/lib/contracts/location-industry"
import { hoursResponseSchema } from "@/lib/contracts/location-hours"
import { gbpChangeSetResponseSchema, gbpChangeSetsResponseSchema } from "@/lib/contracts/gbp-change-set"
import { z } from "zod"
import { serviceMetadataResponseSchema } from "@/lib/contracts/location-business-information"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("standalone NabaPresence canonical management", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      GBP_PROFILE_WRITES_ENABLED: "true",
      GBP_FOOD_MENUS_ENABLED: "true",
      PUBLISH_ENABLED: "true",
      DATABASE_SESSION_URL: process.env.TEST_RUNTIME_DATABASE_URL!,
      DATABASE_POOL_MAX: "1",
    })
  })

  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("rejects invalid service variants and prices before any provider request", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    google.reset()
    const structured = { structuredServiceItem: { serviceTypeId: "job_type_id:repair" } }
    for (const item of [
      { arbitrary: true },
      { ...structured, freeFormServiceItem: { category: "gcid:plumber", label: { displayName: "Visit" } } },
      { ...structured, price: { currencyCode: "GBP", units: "1.25" } },
      { freeFormServiceItem: { categoryId: "gcid:plumber", label: { displayName: "Visit" } } },
    ]) {
      const response = await fetch(`${server.baseUrl}/api/locations/${linked.locationId}/business-information`, {
        method: "PATCH", headers: jsonHeaders(owner.cookie, "invalid-service"),
        body: JSON.stringify({ operation: "update_location", confirmation: "publish_business_information_to_google", expectedGoogleHash: "a".repeat(64), updateMask: ["serviceItems"], payload: { serviceItems: [item] } }),
      })
      expect(response.status, await response.clone().text()).toBe(400)
    }
    expect(google.calls).toHaveLength(0)
    const attempts = await admin`select id from gbp_management_mutation where organisation_id = ${owner.organisationId}`
    expect(attempts).toHaveLength(0)
  })

  it("reviews complete phone collections and recovers a retained additional number without resending", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    google.reset()
    const primaryPhone = "+44 1223 000000"
    const location: Record<string, unknown> = { name: linked.googleLocationName, phoneNumbers: { primaryPhone, additionalPhones: ["+44 1223 000001", "+44 1223 000002"] } }
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: location }))
    google.respond({ method: "GET", pathIncludes: "/attributes" }, () => ({ status: 200, json: { attributes: [], attributeMetadata: [] } }))
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/business-information`
    let mutations = 0
    google.respond({ method: "PATCH", pathIncludes: `/v1/${linked.googleLocationName}` }, (call) => {
      const params = new URL(call.path, google.baseUrl).searchParams
      expect(params.get("updateMask")).toBe("phoneNumbers")
      const body = z.object({ phoneNumbers: z.object({ primaryPhone: z.literal(primaryPhone), additionalPhones: z.array(z.string()) }) }).parse(call.body)
      if (params.get("validateOnly") !== "true") {
        mutations += 1
        if (body.phoneNumbers.additionalPhones.length) location.phoneNumbers = body.phoneNumbers
      }
      return { status: 200, json: location }
    })
    for (const additionalPhones of [["+44 1223 000002"], []]) {
      const loaded = await fetch(url, { headers: { cookie: owner.cookie } })
      const state = businessInformationResponseSchema.parse(await loaded.json()).businessInformation
      const body = { expectedGoogleHash: state.locationHash, updateMask: ["phoneNumbers"], payload: { phoneNumbers: { primaryPhone, additionalPhones } } }
      const incomplete = await fetch(url, { method: "PUT", headers: jsonHeaders(owner.cookie, "incomplete-phones"), body: JSON.stringify({ ...body, payload: { phoneNumbers: { primaryPhone } } }) })
      expect(incomplete.status).toBe(400)
      const preview = await fetch(url, { method: "PUT", headers: jsonHeaders(owner.cookie, "review-phones"), body: JSON.stringify(body) })
      expect(preview.status, await preview.clone().text()).toBe(200)
      const change = gbpChangeSetResponseSchema.parse(await preview.json()).changeSet
      const approval = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "approve-phones"), body: JSON.stringify({ changeSetId: change.id, expectedPayloadHash: change.payloadHash }) })
      expect(approval.status).toBe(200)
      const published = await fetch(url, { method: "PATCH", headers: jsonHeaders(owner.cookie, "publish-phones"), body: JSON.stringify({ ...body, operation: "update_location", confirmation: "publish_business_information_to_google", changeSetId: change.id }) })
      expect(published.status, await published.clone().text()).toBe(200)
      if (additionalPhones.length) {
        expect(await published.json()).toMatchObject({ status: "succeeded", confirmationState: "confirmed" })
        expect(location.phoneNumbers).toEqual({ primaryPhone, additionalPhones })
      } else {
        const unresolved = z.object({ id: z.string(), status: z.literal("ambiguous"), confirmationState: z.literal("unresolved") }).parse(await published.json())
        location.phoneNumbers = { primaryPhone }
        const callsBeforeRecovery = google.calls.filter((call) => call.method === "PATCH").length
        const recovered = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "confirm-phones"), body: JSON.stringify({ mutationId: unresolved.id }) })
        expect(recovered.status).toBe(200)
        expect(await recovered.json()).toMatchObject({ status: "succeeded", confirmationState: "confirmed" })
        expect(google.calls.filter((call) => call.method === "PATCH")).toHaveLength(callsBeforeRecovery)
      }
    }
    expect(mutations).toBe(2)
  }, 60_000)

  it.each(["locality", "administrativeArea", "sublocality", "languageCode", "organization", "sortingCode", "recipients"])("updates address leaf %s without replacing unknown siblings and confirms an omitted cleared value", async (field) => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    google.reset()
    const siblings = Object.fromEntries(Object.entries({ regionCode: "GB", addressLines: ["10 High Street"], postalCode: "CB1 1AA", locality: "Cambridge", administrativeArea: "Cambridgeshire", sublocality: "Centre", languageCode: "en", futureField: "preserved" }).filter(([key]) => key !== field))
    let address: Record<string, unknown> = { ...siblings, [field]: field === "recipients" ? ["Original recipient"] : field === "languageCode" ? "en" : "Original" }
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: { name: linked.googleLocationName, storefrontAddress: address } }))
    google.respond({ method: "GET", pathIncludes: "/attributes" }, () => ({ status: 200, json: { attributes: [], attributeMetadata: [] } }))
    let mutations = 0
    google.respond({ method: "PATCH", pathIncludes: `/v1/${linked.googleLocationName}` }, (call) => {
      const params = new URL(call.path, google.baseUrl).searchParams
      expect(params.get("updateMask")).toBe(`storefrontAddress.${field}`)
      const body = z.object({ storefrontAddress: z.record(z.string(), z.unknown()) }).parse(call.body)
      const value = field === "recipients" ? z.array(z.string()).parse(body.storefrontAddress[field]) : z.string().parse(body.storefrontAddress[field])
      if (params.get("validateOnly") !== "true") {
        mutations += 1
        if (value.length) address = { ...address, [field]: value }
      }
      return { status: 200, json: { name: linked.googleLocationName, storefrontAddress: address } }
    })
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/business-information`
    for (const value of field === "recipients" ? [["Reception", "Manager"], []] : [field === "languageCode" ? "cy" : "Updated", ""]) {
      const loaded = await fetch(url, { headers: { cookie: owner.cookie } })
      const state = businessInformationResponseSchema.parse(await loaded.json()).businessInformation
      const body = { expectedGoogleHash: state.locationHash, updateMask: [`storefrontAddress.${field}`], payload: { storefrontAddress: { regionCode: "GB", addressLines: ["10 High Street"], [field]: value } } }
      const incomplete = await fetch(url, { method: "PUT", headers: jsonHeaders(owner.cookie, "incomplete-address"), body: JSON.stringify({ ...body, payload: { storefrontAddress: { regionCode: "GB", addressLines: ["10 High Street"] } } }) })
      expect(incomplete.status).toBe(400)
      const preview = await fetch(url, { method: "PUT", headers: jsonHeaders(owner.cookie, "review-address"), body: JSON.stringify(body) })
      expect(preview.status, await preview.clone().text()).toBe(200)
      const change = gbpChangeSetResponseSchema.parse(await preview.json()).changeSet
      const approval = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "approve-address"), body: JSON.stringify({ changeSetId: change.id, expectedPayloadHash: change.payloadHash }) })
      expect(approval.status).toBe(200)
      const published = await fetch(url, { method: "PATCH", headers: jsonHeaders(owner.cookie, "publish-address"), body: JSON.stringify({ ...body, operation: "update_location", confirmation: "publish_business_information_to_google", changeSetId: change.id }) })
      expect(published.status, await published.clone().text()).toBe(200)
      expect(address).toMatchObject(siblings)
      if (value.length) {
        expect(await published.json()).toMatchObject({ status: "succeeded", confirmationState: "confirmed" })
        expect(address[field]).toEqual(value)
      } else {
        const attempt = z.object({ id: z.string(), status: z.literal("ambiguous"), confirmationState: z.literal("unresolved") }).parse(await published.json())
        delete address[field]
        const patches = google.calls.filter((call) => call.method === "PATCH").length
        const confirmation = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "confirm-address"), body: JSON.stringify({ mutationId: attempt.id }) })
        expect(confirmation.status).toBe(200)
        expect(await confirmation.json()).toMatchObject({ status: "succeeded", confirmationState: "confirmed" })
        expect(google.calls.filter((call) => call.method === "PATCH")).toHaveLength(patches)
      }
    }
    expect(mutations).toBe(2)
  }, 60_000)

  it("requires a reviewed service-area conversion and recovers retained storefront data without rewriting", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    google.reset()
    const location: Record<string, unknown> = { name: linked.googleLocationName, serviceArea: { businessType: "CUSTOMER_AND_BUSINESS_LOCATION", regionCode: "GB" }, storefrontAddress: { regionCode: "GB", addressLines: ["10 High Street"] } }
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: location }))
    google.respond({ method: "GET", pathIncludes: "/attributes" }, () => ({ status: 200, json: { attributes: [], attributeMetadata: [] } }))
    let mutations = 0
    google.respond({ method: "PATCH", pathIncludes: `/v1/${linked.googleLocationName}` }, (call) => {
      const params = new URL(call.path, google.baseUrl).searchParams
      expect(params.get("updateMask")?.split(",").sort()).toEqual(["serviceArea", "storefrontAddress"])
      const payload = z.object({ serviceArea: z.record(z.string(), z.unknown()), storefrontAddress: z.object({}).strict() }).parse(call.body)
      if (params.get("validateOnly") !== "true") {
        mutations += 1
        location.serviceArea = payload.serviceArea
      }
      return { status: 200, json: location }
    })
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/business-information`
    const loaded = await fetch(url, { headers: { cookie: owner.cookie } })
    const state = businessInformationResponseSchema.parse(await loaded.json()).businessInformation
    const serviceArea = { businessType: "CUSTOMER_LOCATION_ONLY", regionCode: "GB", places: { placeInfos: [{ placeName: "Cambridge", placeId: "ChIJ_test" }] } }
    const body = { expectedGoogleHash: state.locationHash, updateMask: ["serviceArea", "storefrontAddress"], payload: { serviceArea, storefrontAddress: {} } }
    for (const invalid of [
      { ...body, updateMask: ["serviceArea"], payload: { serviceArea } },
      { ...body, payload: { ...body.payload, serviceArea: { ...serviceArea, regionCode: "IE" } } },
    ]) {
      const rejected = await fetch(url, { method: "PUT", headers: jsonHeaders(owner.cookie, "invalid-area"), body: JSON.stringify(invalid) })
      expect(rejected.status, await rejected.clone().text()).toBe(400)
      expect(await rejected.json()).toMatchObject({ error: "service_area_invalid" })
    }
    expect(google.calls.filter((call) => call.method === "PATCH")).toHaveLength(0)
    const preview = await fetch(url, { method: "PUT", headers: jsonHeaders(owner.cookie, "review-area"), body: JSON.stringify(body) })
    expect(preview.status, await preview.clone().text()).toBe(200)
    const change = gbpChangeSetResponseSchema.parse(await preview.json()).changeSet
    const approval = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "approve-area"), body: JSON.stringify({ changeSetId: change.id, expectedPayloadHash: change.payloadHash }) })
    expect(approval.status).toBe(200)
    const published = await fetch(url, { method: "PATCH", headers: jsonHeaders(owner.cookie, "publish-area"), body: JSON.stringify({ ...body, operation: "update_location", confirmation: "publish_business_information_to_google", changeSetId: change.id }) })
    expect(published.status, await published.clone().text()).toBe(200)
    const attempt = z.object({ id: z.string(), status: z.literal("ambiguous"), confirmationState: z.literal("unresolved") }).parse(await published.json())
    delete location.storefrontAddress
    const patches = google.calls.filter((call) => call.method === "PATCH").length
    const confirmed = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "confirm-area"), body: JSON.stringify({ mutationId: attempt.id }) })
    expect(confirmed.status, await confirmed.clone().text()).toBe(200)
    expect(await confirmed.json()).toMatchObject({ status: "succeeded", confirmationState: "confirmed" })
    expect(google.calls.filter((call) => call.method === "PATCH")).toHaveLength(patches)
    expect(mutations).toBe(1)
  }, 60_000)

  it.each([
    { field: "parentChain", value: "chains/123", clear: "" },
    { field: "parentLocation", value: { placeId: "ChIJ_parent", relationType: "DEPARTMENT_OF" }, clear: {} },
    { field: "childrenLocations", value: [{ placeId: "ChIJ_child", relationType: "INDEPENDENT_ESTABLISHMENT_IN" }], clear: [] },
  ])("preserves relationship siblings and recovers an unresolved $field clear", async ({ field, value, clear }) => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    google.reset()
    const siblings = Object.fromEntries(Object.entries({ parentChain: "chains/999", parentLocation: { placeId: "ChIJ_other", relationType: "DEPARTMENT_OF" }, childrenLocations: [{ placeId: "ChIJ_preserved", relationType: "DEPARTMENT_OF" }], futureField: "preserved" }).filter(([key]) => key !== field))
    const relationship: Record<string, unknown> = { ...siblings }
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: { name: linked.googleLocationName, relationshipData: relationship } }))
    google.respond({ method: "GET", pathIncludes: "/attributes" }, () => ({ status: 200, json: { attributes: [], attributeMetadata: [] } }))
    let mutations = 0
    let retainClear = false
    google.respond({ method: "PATCH", pathIncludes: `/v1/${linked.googleLocationName}` }, (call) => {
      const params = new URL(call.path, google.baseUrl).searchParams
      expect(params.get("updateMask")).toBe(`relationshipData.${field}`)
      const body = z.object({ relationshipData: z.record(z.string(), z.unknown()) }).parse(call.body)
      expect(Object.keys(body.relationshipData)).toEqual([field])
      if (params.get("validateOnly") !== "true") {
        mutations += 1
        if (!retainClear) relationship[field] = body.relationshipData[field]
      }
      return { status: 200, json: { relationshipData: relationship } }
    })
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/business-information`
    for (const next of [value, clear]) {
      const loaded = await fetch(url, { headers: { cookie: owner.cookie } })
      const state = businessInformationResponseSchema.parse(await loaded.json()).businessInformation
      const body = { expectedGoogleHash: state.locationHash, updateMask: [`relationshipData.${field}`], payload: { relationshipData: { [field]: next } } }
      const missing = await fetch(url, { method: "PUT", headers: jsonHeaders(owner.cookie, "missing-relationship"), body: JSON.stringify({ ...body, payload: { relationshipData: {} } }) })
      expect(missing.status).toBe(400)
      const preview = await fetch(url, { method: "PUT", headers: jsonHeaders(owner.cookie, "review-relationship"), body: JSON.stringify(body) })
      expect(preview.status, await preview.clone().text()).toBe(200)
      const change = gbpChangeSetResponseSchema.parse(await preview.json()).changeSet
      const approval = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "approve-relationship"), body: JSON.stringify({ changeSetId: change.id, expectedPayloadHash: change.payloadHash }) })
      expect(approval.status).toBe(200)
      const published = await fetch(url, { method: "PATCH", headers: jsonHeaders(owner.cookie, "publish-relationship"), body: JSON.stringify({ ...body, operation: "update_location", confirmation: "publish_business_information_to_google", changeSetId: change.id }) })
      expect(published.status, await published.clone().text()).toBe(200)
      expect(relationship).toMatchObject(siblings)
      if (!retainClear) {
        expect(await published.json()).toMatchObject({ status: "succeeded", confirmationState: "confirmed" })
        expect(relationship[field]).toEqual(value)
        retainClear = true
      } else {
        const attempt = z.object({ id: z.string(), status: z.literal("ambiguous"), confirmationState: z.literal("unresolved") }).parse(await published.json())
        delete relationship[field]
        const patches = google.calls.filter((call) => call.method === "PATCH").length
        const recovered = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "confirm-relationship"), body: JSON.stringify({ mutationId: attempt.id }) })
        expect(recovered.status, await recovered.clone().text()).toBe(200)
        expect(await recovered.json()).toMatchObject({ status: "succeeded", confirmationState: "confirmed" })
        expect(google.calls.filter((call) => call.method === "PATCH")).toHaveLength(patches)
      }
    }
    expect(mutations).toBe(2)
  }, 60_000)

  it("sets and clears the ads phone with unknown-field protection and read-only recovery", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    google.reset()
    const phones = { primaryPhone: "+44 20 7946 0100", additionalPhones: ["+44 20 7946 0101"] }
    const location: Record<string, unknown> = { name: linked.googleLocationName, phoneNumbers: phones, adWordsLocationExtensions: { adPhone: "+44 20 7946 0123", futureField: "preserved" } }
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, (call) => {
      expect(new URL(call.path, google.baseUrl).searchParams.get("readMask")).toContain("adWordsLocationExtensions")
      return { status: 200, json: location }
    })
    google.respond({ method: "GET", pathIncludes: "/attributes" }, () => ({ status: 200, json: { attributes: [], attributeMetadata: [] } }))
    let mutations = 0
    google.respond({ method: "PATCH", pathIncludes: `/v1/${linked.googleLocationName}` }, (call) => {
      const params = new URL(call.path, google.baseUrl).searchParams
      expect(params.get("updateMask")).toBe("adWordsLocationExtensions")
      const body = z.object({ name: z.string(), adWordsLocationExtensions: z.record(z.string(), z.unknown()) }).strict().parse(call.body)
      if (params.get("validateOnly") !== "true") {
        mutations += 1
        if (Object.keys(body.adWordsLocationExtensions).length) location.adWordsLocationExtensions = body.adWordsLocationExtensions
      }
      return { status: 200, json: location }
    })
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/business-information`
    async function preview(payload: Record<string, unknown>) {
      const loaded = await fetch(url, { headers: { cookie: owner.cookie } })
      const state = businessInformationResponseSchema.parse(await loaded.json()).businessInformation
      const body = { expectedGoogleHash: state.locationHash, updateMask: ["adWordsLocationExtensions"], payload: { adWordsLocationExtensions: payload } }
      const response = await fetch(url, { method: "PUT", headers: jsonHeaders(owner.cookie, "review-ads-phone"), body: JSON.stringify(body) })
      return { body, response }
    }
    const blocked = await preview({ adPhone: "+44 20 7946 0124" })
    expect(blocked.response.status).toBe(409)
    expect(await blocked.response.json()).toMatchObject({ error: "advertising_baseline_unsupported" })
    expect(google.calls.filter((call) => call.method === "PATCH")).toHaveLength(0)
    delete location.adWordsLocationExtensions
    for (const payload of [{ adPhone: "+44 20 7946 0124" }, {}]) {
      const { body, response } = await preview(payload)
      expect(response.status, await response.clone().text()).toBe(200)
      const change = gbpChangeSetResponseSchema.parse(await response.json()).changeSet
      const approval = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "approve-ads-phone"), body: JSON.stringify({ changeSetId: change.id, expectedPayloadHash: change.payloadHash }) })
      expect(approval.status).toBe(200)
      const published = await fetch(url, { method: "PATCH", headers: jsonHeaders(owner.cookie, "publish-ads-phone"), body: JSON.stringify({ ...body, operation: "update_location", confirmation: "publish_business_information_to_google", changeSetId: change.id }) })
      expect(published.status, await published.clone().text()).toBe(200)
      expect(location.phoneNumbers).toEqual(phones)
      if ("adPhone" in payload) expect(await published.json()).toMatchObject({ status: "succeeded", confirmationState: "confirmed" })
      else {
        const attempt = z.object({ id: z.string(), status: z.literal("ambiguous"), confirmationState: z.literal("unresolved") }).parse(await published.json())
        delete location.adWordsLocationExtensions
        const patches = google.calls.filter((call) => call.method === "PATCH").length
        const recovered = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "confirm-ads-phone"), body: JSON.stringify({ mutationId: attempt.id }) })
        expect(recovered.status, await recovered.clone().text()).toBe(200)
        expect(await recovered.json()).toMatchObject({ status: "succeeded", confirmationState: "confirmed" })
        expect(google.calls.filter((call) => call.method === "PATCH")).toHaveLength(patches)
      }
    }
    expect(mutations).toBe(2)
  }, 60_000)

  it("loads exact category choices and rejects unsupported service changes before writes", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    google.reset()
    const location: Record<string, unknown> = { name: linked.googleLocationName, metadata: { canModifyServiceList: true }, categories: { primaryCategory: { name: "gcid:plumber" } }, storefrontAddress: { regionCode: "GB" }, serviceItems: [] }
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: location }))
    let incomplete = false
    google.respond({ method: "GET", pathIncludes: "/categories:batchGet" }, (call) => {
      const params = new URL(call.path, google.baseUrl).searchParams
      expect(params.getAll("names")).toEqual(["gcid:plumber"])
      expect(params.get("view")).toBe("FULL")
      return { status: 200, json: { categories: incomplete ? [] : [{ name: "gcid:plumber", displayName: "Plumber", serviceTypes: [{ serviceTypeId: "job_type_id:repair", displayName: "Repair" }] }] } }
    })
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/business-information`
    const loaded = await fetch(`${url}?type=services`, { headers: { cookie: owner.cookie } })
    expect(loaded.status, await loaded.clone().text()).toBe(200)
    const metadata = serviceMetadataResponseSchema.parse(await loaded.json()).serviceMetadata
    expect(metadata.categories[0]?.serviceTypes[0]?.serviceTypeId).toBe("job_type_id:repair")
    const body = { operation: "update_location", confirmation: "publish_business_information_to_google", expectedGoogleHash: metadata.locationHash, updateMask: ["serviceItems"], payload: { serviceItems: [{ structuredServiceItem: { serviceTypeId: "unknown:service" } }] } }
    const rejected = await fetch(url, { method: "PUT", headers: jsonHeaders(owner.cookie, "unsupported-service"), body: JSON.stringify({ expectedGoogleHash: body.expectedGoogleHash, updateMask: body.updateMask, payload: body.payload }) })
    expect(rejected.status).toBe(409)
    expect(await rejected.json()).toMatchObject({ error: "service_not_supported" })
    incomplete = true
    const unavailable = await fetch(`${url}?type=services`, { headers: { cookie: owner.cookie } })
    expect(unavailable.status).toBe(409)
    expect(await unavailable.json()).toMatchObject({ error: "service_metadata_incomplete" })
    expect(google.calls.filter((call) => call.method === "PATCH")).toHaveLength(0)
    expect(await admin`select id from gbp_management_mutation where organisation_id = ${owner.organisationId}`).toHaveLength(0)
    incomplete = false
    const legacy = { structuredServiceItem: { serviceTypeId: "legacy:unchanged" } }
    location.serviceItems = [legacy]
    const desired = [legacy, { structuredServiceItem: { serviceTypeId: "job_type_id:repair", description: "Repair fittings" }, price: { currencyCode: "GBP", units: "35" } }]
    let mutations = 0
    google.respond({ method: "PATCH", pathIncludes: `/v1/${linked.googleLocationName}` }, (call) => {
      expect(call.body).toEqual({ name: linked.googleLocationName, serviceItems: desired })
      if (new URL(call.path, google.baseUrl).searchParams.get("validateOnly") !== "true") {
        mutations += 1
        location.serviceItems = desired
      }
      return { status: 200, json: location }
    })
    const refreshed = await fetch(`${url}?type=services`, { headers: { cookie: owner.cookie } })
    const baseline = serviceMetadataResponseSchema.parse(await refreshed.json()).serviceMetadata
    async function reviewServices(expectedGoogleHash: string, serviceItems: unknown[]) {
      const preview = await fetch(url, { method: "PUT", headers: jsonHeaders(owner.cookie, "review-services"), body: JSON.stringify({ expectedGoogleHash, updateMask: ["serviceItems"], payload: { serviceItems } }) })
      expect(preview.status, await preview.clone().text()).toBe(200)
      const change = gbpChangeSetResponseSchema.parse(await preview.json()).changeSet
      const unapproved = await fetch(url, { method: "PATCH", headers: jsonHeaders(owner.cookie, "unapproved-services"), body: JSON.stringify({ ...body, expectedGoogleHash, payload: { serviceItems }, changeSetId: change.id }) })
      expect(unapproved.status).toBe(409)
      expect(await unapproved.json()).toMatchObject({ error: "approval_required" })
      const approved = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "approve-services"), body: JSON.stringify({ changeSetId: change.id, expectedPayloadHash: change.payloadHash }) })
      expect(approved.status, await approved.clone().text()).toBe(200)
      return { ...body, expectedGoogleHash, payload: { serviceItems }, changeSetId: change.id }
    }
    const reviewed = await reviewServices(baseline.locationHash, desired)
    const altered = await fetch(url, { method: "PATCH", headers: jsonHeaders(owner.cookie, "alter-services"), body: JSON.stringify({ ...reviewed, payload: { serviceItems: [] } }) })
    expect(altered.status).toBe(409)
    expect(await altered.json()).toMatchObject({ error: "approval_stale" })
    const wrongFamily = await fetch(`${server.baseUrl}/api/locations/${linked.locationId}/industry`, { method: "POST", headers: jsonHeaders(owner.cookie, "wrong-family"), body: JSON.stringify({ action: "approve_lodging", changeSetId: reviewed.changeSetId, expectedPayloadHash: "a".repeat(64) }) })
    expect(wrongFamily.status).toBe(404)
    const published = await fetch(url, { method: "PATCH", headers: jsonHeaders(owner.cookie, "supported-services"), body: JSON.stringify(reviewed) })
    expect(published.status, await published.clone().text()).toBe(200)
    expect(await published.json()).toMatchObject({ status: "succeeded" })
    expect(mutations).toBe(1)
    const repeated = await fetch(url, { method: "PATCH", headers: jsonHeaders(owner.cookie, "repeat-services"), body: JSON.stringify(reviewed) })
    expect(repeated.status).toBe(200)
    expect(await repeated.json()).toMatchObject({ idempotent: true })
    expect(mutations).toBe(1)
    const pendingReviews = await fetch(`${url}?type=reviews`, { headers: { cookie: owner.cookie } })
    expect(pendingReviews.status).toBe(200)
    expect(gbpChangeSetsResponseSchema.parse(await pendingReviews.json()).changeSets).toEqual([])
    google.respond({ method: "PATCH", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: location }))
    const beforeClear = await fetch(`${url}?type=services`, { headers: { cookie: owner.cookie } })
    const clearBaseline = serviceMetadataResponseSchema.parse(await beforeClear.json()).serviceMetadata
    const cleared = [legacy, { structuredServiceItem: { serviceTypeId: "job_type_id:repair", description: "Repair fittings" } }]
    const clearReview = await reviewServices(clearBaseline.locationHash, cleared)
    const retainedPrice = await fetch(url, { method: "PATCH", headers: jsonHeaders(owner.cookie, "clear-service-price"), body: JSON.stringify(clearReview) })
    expect(retainedPrice.status).toBe(200)
    const unresolved = z.object({ id: z.string(), status: z.string(), executionState: z.string(), confirmationState: z.string() }).parse(await retainedPrice.json())
    expect(unresolved).toMatchObject({ status: "ambiguous", executionState: "accepted", confirmationState: "unresolved" })
    const activity = await fetch(`${server.baseUrl}/api/locations/${linked.locationId}/activity`, { headers: { cookie: owner.cookie } })
    expect(await activity.json()).toMatchObject({ activity: { items: expect.arrayContaining([expect.objectContaining({ sourceId: unresolved.id, canConfirm: true, confirmationState: "unresolved" })]) } })
    const callsBeforeRecovery = google.calls.filter((call) => call.method === "PATCH").length
    const stillUnresolved = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "check-services-unresolved"), body: JSON.stringify({ mutationId: unresolved.id }) })
    expect(stillUnresolved.status).toBe(200)
    expect(await stillUnresolved.json()).toMatchObject({ status: "ambiguous", confirmationState: "unresolved" })
    const outsider = await createTestTenant(admin)
    organisations.push(outsider.organisationId)
    const forbidden = await fetch(url, { method: "POST", headers: jsonHeaders(outsider.cookie, "check-services-cross-tenant"), body: JSON.stringify({ mutationId: unresolved.id }) })
    expect(forbidden.status).toBe(404)
    location.serviceItems = cleared
    const recovered = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "check-services-confirmed"), body: JSON.stringify({ mutationId: unresolved.id }) })
    expect(recovered.status, await recovered.clone().text()).toBe(200)
    expect(await recovered.json()).toMatchObject({ status: "succeeded", executionState: "accepted", confirmationState: "confirmed" })
    const checkedAgain = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "check-services-again"), body: JSON.stringify({ mutationId: unresolved.id }) })
    expect(await checkedAgain.json()).toMatchObject({ status: "succeeded", idempotent: true, confirmationState: "confirmed" })
    expect(google.calls.filter((call) => call.method === "PATCH")).toHaveLength(callsBeforeRecovery)
    const [confirmed] = await admin`select execution_state, confirmation_state, confirmation_response, google_response from gbp_management_mutation where id = ${unresolved.id}`
    expect(confirmed).toMatchObject({ execution_state: "accepted", confirmation_state: "confirmed", confirmation_response: { serviceItems: cleared } })
    expect(confirmed.google_response).toMatchObject({ serviceItems: desired })
    const beforeLostResponse = await fetch(`${url}?type=services`, { headers: { cookie: owner.cookie } })
    const nextBaseline = serviceMetadataResponseSchema.parse(await beforeLostResponse.json()).serviceMetadata
    const emptyReview = await reviewServices(nextBaseline.locationHash, [])
    let lostResponseWrites = 0
    google.respond({ method: "PATCH", pathIncludes: `/v1/${linked.googleLocationName}` }, (call) => {
      if (new URL(call.path, google.baseUrl).searchParams.get("validateOnly") === "true") return { status: 200, json: location }
      lostResponseWrites += 1
      location.serviceItems = []
      return { status: 503, json: { error: { message: "Response unavailable after application" } } }
    })
    const lostResponse = await fetch(url, { method: "PATCH", headers: jsonHeaders(owner.cookie, "services-lost-response"), body: JSON.stringify(emptyReview) })
    expect(lostResponse.status, await lostResponse.clone().text()).toBe(200)
    expect(await lostResponse.json()).toMatchObject({ status: "succeeded", executionState: "unknown", confirmationState: "confirmed" })
    expect(lostResponseWrites).toBe(1)
  }, 30_000)

  it("requires a second services approver and rejects a revoked approver before publishing", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const reviewer = await createTestTenant(admin)
    organisations.push(reviewer.organisationId)
    await admin`insert into member (organisation_id, user_id, role) values (${owner.organisationId}, ${reviewer.userId}, 'admin')`
    await admin`update app_session set organisation_id = ${owner.organisationId} where user_id = ${reviewer.userId}`
    await admin`update organisation set require_two_person_approval = true where id = ${owner.organisationId}`
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    google.reset()
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: { metadata: { canModifyServiceList: true }, categories: { primaryCategory: { name: "gcid:plumber" } } } }))
    google.respond({ method: "GET", pathIncludes: "/categories:batchGet" }, () => ({ status: 200, json: { categories: [{ name: "gcid:plumber" }] } }))
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/business-information`
    const metadata = await fetch(`${url}?type=services`, { headers: { cookie: owner.cookie } })
    const { locationHash } = serviceMetadataResponseSchema.parse(await metadata.json()).serviceMetadata
    const body = { expectedGoogleHash: locationHash, updateMask: ["serviceItems"], payload: { serviceItems: [] } }
    const preview = await fetch(url, { method: "PUT", headers: jsonHeaders(owner.cookie, "two-person-services"), body: JSON.stringify(body) })
    expect(preview.status, await preview.clone().text()).toBe(200)
    const change = gbpChangeSetResponseSchema.parse(await preview.json()).changeSet
    const approval = { changeSetId: change.id, expectedPayloadHash: change.payloadHash }
    const callsBeforeReview = google.calls.length
    const reopened = await fetch(`${url}?type=reviews`, { headers: { cookie: reviewer.cookie } })
    expect(reopened.status).toBe(200)
    expect(gbpChangeSetsResponseSchema.parse(await reopened.json()).changeSets).toEqual([{ ...change, canApprove: true }])
    expect(google.calls).toHaveLength(callsBeforeReview)
    await admin`update member set role = 'member', can_publish = true where organisation_id = ${owner.organisationId} and user_id = ${reviewer.userId}`
    const memberRead = await fetch(`${url}?type=reviews`, { headers: { cookie: reviewer.cookie } })
    expect(memberRead.status).toBe(403)
    await admin`update member set role = 'admin' where organisation_id = ${owner.organisationId} and user_id = ${reviewer.userId}`
    const other = await createTestTenant(admin)
    organisations.push(other.organisationId)
    const hidden = await fetch(`${url}?type=reviews`, { headers: { cookie: other.cookie } })
    expect(hidden.status).toBe(404)
    const self = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "self-services"), body: JSON.stringify(approval) })
    expect(self.status).toBe(409)
    expect(await self.json()).toMatchObject({ error: "second_approver_required" })
    const approved = await fetch(url, { method: "POST", headers: jsonHeaders(reviewer.cookie, "second-services"), body: JSON.stringify(approval) })
    expect(approved.status).toBe(200)
    await admin`delete from member where organisation_id = ${owner.organisationId} and user_id = ${reviewer.userId}`
    const revoked = await fetch(url, { method: "PATCH", headers: jsonHeaders(owner.cookie, "revoked-services"), body: JSON.stringify({ ...body, changeSetId: change.id, operation: "update_location", confirmation: "publish_business_information_to_google" }) })
    expect(revoked.status).toBe(409)
    expect(await revoked.json()).toMatchObject({ error: "approval_actor_access_changed" })
    const revokedRead = await fetch(`${url}?type=reviews`, { headers: { cookie: reviewer.cookie } })
    expect(revokedRead.status).toBe(401)
    await admin`update gbp_change_set set approval_expires_at = now() - interval '1 second' where id = ${change.id}`
    const expired = await fetch(`${url}?type=reviews`, { headers: { cookie: owner.cookie } })
    expect(expired.status).toBe(200)
    expect(gbpChangeSetsResponseSchema.parse(await expired.json()).changeSets).toEqual([])
    expect(google.calls.every((call) => call.method === "GET")).toBe(true)
  }, 15_000)

  async function reviewedLodging(cookie: string, locationId: string, payload: Record<string, unknown>, updateMask: string[], approverCookie: string | null = cookie) {
    const url = `${server.baseUrl}/api/locations/${locationId}/industry`
    const loaded = await fetch(url, { headers: { cookie } })
    expect(loaded.status, await loaded.clone().text()).toBe(200)
    const industry = industryResponseSchema.parse(await loaded.json()).industry
    const preview = await fetch(url, { method: "PUT", headers: jsonHeaders(cookie, "preview-lodging"), body: JSON.stringify({ payload, updateMask, expectedGoogleHash: industry.lodgingHash }) })
    expect(preview.status, await preview.clone().text()).toBe(200)
    const change = gbpChangeSetResponseSchema.parse(await preview.json()).changeSet
    if (approverCookie) {
      const approved = await fetch(url, { method: "POST", headers: jsonHeaders(approverCookie, "approve-lodging"), body: JSON.stringify({ action: "approve_lodging", changeSetId: change.id, expectedPayloadHash: change.payloadHash }) })
      expect(approved.status, await approved.clone().text()).toBe(200)
    }
    return { operation: "update_lodging", confirmation: "publish_industry_data_to_google", changeSetId: change.id, updateMask: change.updateMask, payload: change.payload }
  }

  it("reads the exact saved lodging attempt without Google, including after disconnection, and denies other tenants", async () => {
    const owner = await createTestTenant(admin), other = await createTestTenant(admin)
    organisations.push(owner.organisationId, other.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    google.reset()
    let provider: Record<string, unknown> = { pets: { petsAllowed: false } }
    google.respond({ method: "GET", pathIncludes: "/lodging" }, () => ({ status: 200, json: provider }))
    google.respond({ method: "PATCH", pathIncludes: "/lodging" }, ({ body }) => { provider = z.record(z.string(), z.unknown()).parse(body); return { status: 200, json: provider } })
    const body = await reviewedLodging(owner.cookie, linked.locationId, { pets: { petsAllowed: true } }, ["pets.petsAllowed"])
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/industry`
    const savedUrl = `${url}?reviewId=${body.changeSetId}`
    const before = google.calls.length
    const absent = await fetch(savedUrl, { headers: { cookie: owner.cookie } })
    expect(absent.status).toBe(404)
    expect(await absent.json()).toMatchObject({ error: "lodging_attempt_not_found" })
    expect(google.calls).toHaveLength(before)
    const sent = await fetch(url, { method: "PATCH", headers: jsonHeaders(owner.cookie, "saved-lodging"), body: JSON.stringify(body) })
    expect(sent.status, await sent.clone().text()).toBe(200)
    const requests = google.calls.length
    const saved = await fetch(savedUrl, { headers: { cookie: owner.cookie } })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ attempt: { reviewId: body.changeSetId, targetResourceName: linked.googleLocationName, executionState: "accepted", confirmationState: "confirmed", observedAt: expect.any(String), idempotent: true } })
    await admin`update google_connection set status = 'disconnected' where id = ${connection.connectionId}`
    const disconnected = await fetch(savedUrl, { headers: { cookie: owner.cookie } })
    expect(disconnected.status).toBe(200)
    await admin`update gbp_change_set set approval_expires_at = now() - interval '1 hour' where id = ${body.changeSetId}`
    const index = await fetch(`${url}?type=workflows`, { headers: { cookie: owner.cookie } })
    expect(index.status).toBe(200)
    expect(await index.json()).toMatchObject({ items: [{ changeSet: { id: body.changeSetId, targetResourceName: linked.googleLocationName }, attemptId: expect.any(String) }], nextCursor: null })
    const inaccessible = await fetch(savedUrl, { headers: { cookie: other.cookie } })
    expect(inaccessible.status).toBe(404)
    expect(google.calls).toHaveLength(requests)
  }, 20_000)

  it("paginates saved lodging work without losing PostgreSQL timestamp precision and rejects wrong-scope cursors", async () => {
    const owner = await createTestTenant(admin); organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    google.reset()
    google.respond({ method: "GET", pathIncludes: "/lodging" }, () => ({ status: 200, json: { pets: { petsAllowed: false } } }))
    const body = await reviewedLodging(owner.cookie, linked.locationId, { pets: { petsAllowed: true } }, ["pets.petsAllowed"], null)
    await admin`update gbp_change_set set created_at = '2026-09-30T08:00:00.123450Z'::timestamptz where id = ${body.changeSetId}`
    for (let index = 1; index <= 6; index++) await admin`
      insert into gbp_change_set (organisation_id,location_id,google_account_id,connection_id,target_resource_name,resource_type,requested_by,payload,payload_hash,update_mask,baseline,baseline_hash,require_two_person_approval,approval_expires_at,created_at)
      select organisation_id,location_id,google_account_id,connection_id,target_resource_name,resource_type,requested_by,payload,payload_hash,update_mask,baseline,baseline_hash,require_two_person_approval,approval_expires_at,
        created_at + ${index}::integer * interval '1 microsecond' from gbp_change_set where id = ${body.changeSetId}
    `
    const expected = await admin<{ id: string }[]>`select id from gbp_change_set where organisation_id = ${owner.organisationId} and resource_type = 'lodging' order by created_at desc,id desc`
    const requests = google.calls.length, seen: string[] = []
    let cursor: string | null = null
    do {
      const params = new URLSearchParams({ type: "workflows", limit: "2" })
      if (cursor) params.set("cursor", cursor)
      const page = await fetch(`${server.baseUrl}/api/locations/${linked.locationId}/industry?${params}`, { headers: { cookie: owner.cookie } })
      expect(page.status).toBe(200)
      const result = z.object({ items: z.array(z.object({ changeSet: z.object({ id: z.uuid() }) })), nextCursor: z.string().nullable() }).parse(await page.json())
      seen.push(...result.items.map((item) => item.changeSet.id)); cursor = result.nextCursor
      expect(seen.length).toBeLessThanOrEqual(expected.length)
    } while (cursor)
    expect(seen).toEqual(expected.map((row) => row.id))
    expect(google.calls).toHaveLength(requests)
    const otherScope = Buffer.from(JSON.stringify({ locationId: owner.organisationId, createdAt: "2026-09-30T08:00:00.123450Z", id: body.changeSetId })).toString("base64url")
    const invalid = await fetch(`${server.baseUrl}/api/locations/${linked.locationId}/industry?type=workflows&cursor=${otherScope}`, { headers: { cookie: owner.cookie } })
    expect(invalid.status).toBe(400)
  }, 20_000)

  it("keeps retired industry resources offline on load and rejects legacy writes", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    google.reset()
    google.respond({ method: "GET", pathIncludes: "/lodging" }, () => ({ status: 200, json: { name: `${linked.googleLocationName}/lodging` } }))
    google.respond({ method: "GET", pathIncludes: "/serviceList" }, () => ({ status: 200, json: { services: [] } }))
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/industry`

    const loaded = await fetch(url, { headers: { cookie: owner.cookie } })

    expect(loaded.status, await loaded.clone().text()).toBe(200)
    expect(await loaded.json()).toMatchObject({ industry: {
      calls: { data: null, error: expect.stringContaining("retired") },
      providerAttributes: { data: null, error: expect.stringContaining("retired") },
      insuranceNetworks: { data: null, error: expect.stringContaining("retired") },
    } })
    expect(google.calls.some((call) => /businesscalls|healthProviderAttributes|insuranceNetworks|questions/.test(call.path))).toBe(false)
    const readCallCount = google.calls.length
    for (const operation of ["update_business_calls", "update_healthcare_provider_attributes"]) {
      const response = await fetch(url, {
        method: "PATCH",
        headers: jsonHeaders(owner.cookie, `retired-${operation}`),
        body: JSON.stringify({
          operation,
          confirmation: "publish_industry_data_to_google",
          updateMask: ["callsState"],
          payload: { callsState: "DISABLED" },
        }),
      })
      expect(response.status, await response.clone().text()).toBe(410)
      expect(await response.json()).toMatchObject({ error: "provider_capability_retired" })
      expect(google.calls).toHaveLength(readCallCount)
    }
    const attempts = await admin`
      select id from gbp_management_mutation where organisation_id = ${owner.organisationId}
    `
    expect(attempts).toHaveLength(0)
    await admin`
      insert into gbp_management_mutation (
        organisation_id, location_id, actor_user_id, resource_type,
        operation, status, idempotency_key, finished_at
      ) values (
        ${owner.organisationId}, ${linked.locationId}, ${owner.userId},
        'business_calls', 'update_business_calls', 'succeeded',
        'historical-calls', now()
      )
    `
    const history = await fetch(`${server.baseUrl}/api/locations/${linked.locationId}/activity`, {
      headers: { cookie: owner.cookie },
    })
    expect(history.status).toBe(200)
    expect(await history.json()).toMatchObject({ activity: { items: [{
      status: "succeeded",
      historicalReason: "Business Calls is retired by Google. Historical records are read-only.",
    }] } })
  })

  it.each([
    { patchStatus: 200, readStatus: 200, observed: true, execution: "accepted", confirmation: "confirmed" },
    { patchStatus: 200, readStatus: 200, observed: false, execution: "accepted", confirmation: "unresolved" },
    { patchStatus: 503, readStatus: 200, observed: true, execution: "unknown", confirmation: "confirmed" },
    { patchStatus: 200, readStatus: 403, observed: false, execution: "accepted", confirmation: "unresolved" },
  ])("records independent lodging evidence for %j", async (scenario) => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    google.reset()
    let applied = false
    let metadata: unknown
    google.respond({ method: "PATCH", pathIncludes: "/lodging" }, (call) => {
      applied = true
      metadata = z.object({ metadata: z.unknown() }).parse(call.body).metadata
      return { status: scenario.patchStatus, json: scenario.patchStatus === 200 ? { pets: { petsAllowed: true } } : { error: { code: 503, message: "Response unavailable" } } }
    })
    google.respond({ method: "GET", pathIncludes: "/lodging" }, () => !applied
      ? { status: 200, json: { pets: { petsAllowed: false } } }
      : { status: scenario.readStatus, json: scenario.readStatus === 200 ? { name: `${linked.googleLocationName}/lodging`, metadata, pets: { petsAllowed: scenario.observed } } : { error: { code: 403, message: "Read unavailable" } } })
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/industry`
    const body = await reviewedLodging(owner.cookie, linked.locationId, { pets: { petsAllowed: true } }, ["pets.petsAllowed"])
    const initialReads = google.calls.filter((call) => call.method === "GET").length
    const response = await fetch(url, { method: "PATCH", headers: jsonHeaders(owner.cookie, "lodging-evidence"), body: JSON.stringify(body) })
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ status: scenario.confirmation === "confirmed" ? "succeeded" : "ambiguous", executionState: scenario.execution, confirmationState: scenario.confirmation })
    expect(google.calls.filter((call) => call.method === "PATCH")).toHaveLength(1)
    expect(google.calls.filter((call) => call.method === "GET")).toHaveLength(initialReads + 2)
    const [attempt] = await admin`select id, execution_state, confirmation_state, google_response, confirmation_response from gbp_management_mutation where organisation_id = ${owner.organisationId}`
    expect(attempt).toMatchObject({ execution_state: scenario.execution, confirmation_state: scenario.confirmation })
    if (scenario.readStatus === 200) expect(attempt.confirmation_response).toMatchObject({ pets: { petsAllowed: scenario.observed } })
    else expect(attempt.confirmation_response).toBeNull()
    const activity = await fetch(`${server.baseUrl}/api/locations/${linked.locationId}/activity`, { headers: { cookie: owner.cookie } })
    expect(await activity.json()).toMatchObject({ activity: { items: [{ executionState: scenario.execution, confirmationState: scenario.confirmation }] } })
    if (scenario.confirmation === "unresolved") {
      const retried = await fetch(url, { method: "PATCH", headers: jsonHeaders(owner.cookie, "another-lodging-intent"), body: JSON.stringify(body) })
      expect(retried.status, await retried.clone().text()).toBe(200)
      expect(await retried.json()).toMatchObject({ status: "ambiguous", idempotent: true })
      expect(google.calls.filter((call) => call.method === "PATCH")).toHaveLength(1)
      google.respond({ method: "GET", pathIncludes: "/lodging" }, () => ({ status: 200, json: { metadata, pets: { petsAllowed: true } } }))
      const recovered = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "confirm-lodging"), body: JSON.stringify({ mutationId: attempt.id }) })
      expect(recovered.status, await recovered.clone().text()).toBe(200)
      expect(await recovered.json()).toMatchObject({ status: "succeeded", executionState: scenario.execution, confirmationState: "confirmed" })
      expect(google.calls.filter((call) => call.method === "PATCH")).toHaveLength(1)
      const callCount = google.calls.length
      const again = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "confirm-again"), body: JSON.stringify({ mutationId: attempt.id }) })
      expect(again.status).toBe(200)
      expect(await again.json()).toMatchObject({ idempotent: true, confirmationState: "confirmed" })
      expect(google.calls).toHaveLength(callCount)
    }
  })

  it("rejects unapproved, altered, stale and policy-changed lodging reviews before a provider write", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    let providerValue = false
    google.reset()
    google.respond({ method: "GET", pathIncludes: "/lodging" }, () => ({ status: 200, json: { pets: { petsAllowed: providerValue } } }))
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/industry`
    const unapproved = await reviewedLodging(owner.cookie, linked.locationId, { pets: { petsAllowed: true } }, ["pets.petsAllowed"], null)
    const approved = await reviewedLodging(owner.cookie, linked.locationId, { pets: { petsAllowed: true } }, ["pets.petsAllowed"])
    async function rejected(body: unknown, code: string) {
      const response = await fetch(url, { method: "PATCH", headers: jsonHeaders(owner.cookie, code), body: JSON.stringify(body) })
      expect(response.status, await response.clone().text()).toBe(409)
      expect(await response.json()).toMatchObject({ error: code })
    }
    await rejected(unapproved, "approval_required")
    await rejected({ ...approved, payload: { ...approved.payload, pets: { petsAllowed: false } } }, "approval_stale")
    await rejected({ ...approved, updateMask: ["pets"] }, "approval_stale")
    providerValue = true
    await rejected(approved, "google_baseline_stale")
    providerValue = false
    await admin`update organisation set require_two_person_approval = true where id = ${owner.organisationId}`
    await rejected(approved, "approval_policy_changed")
    expect(google.calls.every((call) => call.method === "GET")).toBe(true)
    const attempts = await admin`select id from gbp_management_mutation where organisation_id = ${owner.organisationId}`
    expect(attempts).toHaveLength(0)
    const runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, { max: 1 })
    try {
      await expect(runtime.begin(async (sql) => {
        await sql`select set_config('app.organisation_id', ${owner.organisationId}, true)`
        await sql`update gbp_change_set set payload = '{}'::jsonb where id = ${approved.changeSetId}`
      })).rejects.toMatchObject({ code: "42501" })
    } finally {
      await runtime.end()
    }
  })

  it("requires a second approver and rechecks that approver's membership before execution", async () => {
    const owner = await createTestTenant(admin)
    const reviewer = await createTestTenant(admin)
    organisations.push(owner.organisationId, reviewer.organisationId)
    await admin`insert into member (organisation_id, user_id, role) values (${owner.organisationId}, ${reviewer.userId}, 'admin')`
    await admin`update app_session set organisation_id = ${owner.organisationId} where user_id = ${reviewer.userId}`
    await admin`update organisation set require_two_person_approval = true where id = ${owner.organisationId}`
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    google.reset()
    google.respond({ method: "GET", pathIncludes: "/lodging" }, () => ({ status: 200, json: { pets: { petsAllowed: false } } }))
    const body = await reviewedLodging(owner.cookie, linked.locationId, { pets: { petsAllowed: true } }, ["pets.petsAllowed"], reviewer.cookie)
    const [change] = await admin`select payload_hash from gbp_change_set where id = ${body.changeSetId}`
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/industry`
    const self = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "self-approve"), body: JSON.stringify({ action: "approve_lodging", changeSetId: body.changeSetId, expectedPayloadHash: change.payload_hash }) })
    expect(self.status).toBe(409)
    expect(await self.json()).toMatchObject({ error: "second_approver_required" })
    await admin`delete from member where organisation_id = ${owner.organisationId} and user_id = ${reviewer.userId}`
    const revoked = await fetch(url, { method: "PATCH", headers: jsonHeaders(owner.cookie, "revoked-approver"), body: JSON.stringify(body) })
    expect(revoked.status, await revoked.clone().text()).toBe(409)
    expect(await revoked.json()).toMatchObject({ error: "approval_actor_access_changed" })
    expect(google.calls.every((call) => call.method === "GET")).toBe(true)
  })

  it("recovers an interrupted lodging attempt by reading Google without repeating the write", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    const [account] = await admin`select id from google_account where organisation_id = ${owner.organisationId} limit 1`
    const [attempt] = await admin`
      insert into gbp_management_mutation (organisation_id, location_id, google_account_id, actor_user_id, resource_type, operation, target_resource_name, status, idempotency_key, requested_payload, update_mask, execution_state, confirmation_state, created_at)
      values (${owner.organisationId}, ${linked.locationId}, ${account.id}, ${owner.userId}, 'lodging', 'update_lodging', ${linked.googleLocationName}, 'started', 'interrupted-lodging', '{"pets":{"petsAllowed":true}}', array['pets.petsAllowed'], 'pending', 'pending', now() - interval '6 minutes') returning id
    `
    google.reset()
    google.respond({ method: "GET", pathIncludes: "/lodging" }, () => ({ status: 200, json: { pets: { petsAllowed: true } } }))
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/industry`
    const response = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "recover-interruption"), body: JSON.stringify({ mutationId: attempt.id }) })
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ status: "succeeded", executionState: "unknown", confirmationState: "confirmed" })
    expect(google.calls).toHaveLength(1)
    expect(google.calls[0].method).toBe("GET")
  })

  it("guards interrupted service recovery against early checks, target changes, read failures and revoked access", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    const [account] = await admin`select id from google_account where organisation_id = ${owner.organisationId} limit 1`
    google.reset()
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: { metadata: { canModifyServiceList: true }, serviceItems: [] } }))
    google.respond({ method: "GET", pathIncludes: "/attributes" }, () => ({ status: 200, json: { attributes: [], attributeMetadata: [] } }))
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/business-information`
    const current = await fetch(url, { headers: { cookie: owner.cookie } })
    const state = businessInformationResponseSchema.parse(await current.json()).businessInformation
    const preview = await fetch(url, { method: "PUT", headers: jsonHeaders(owner.cookie, "interrupted-services-preview"), body: JSON.stringify({ expectedGoogleHash: state.locationHash, updateMask: ["serviceItems"], payload: { serviceItems: [] } }) })
    expect(preview.status, await preview.clone().text()).toBe(200)
    const change = gbpChangeSetResponseSchema.parse(await preview.json()).changeSet
    const approved = await fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "interrupted-services-approve"), body: JSON.stringify({ changeSetId: change.id, expectedPayloadHash: change.payloadHash }) })
    expect(approved.status).toBe(200)
    const [attempt] = await admin`
      insert into gbp_management_mutation (organisation_id, location_id, google_account_id, actor_user_id, resource_type, operation, target_resource_name, status, idempotency_key, requested_payload, update_mask, execution_state, confirmation_state, change_set_id)
      values (${owner.organisationId}, ${linked.locationId}, ${account.id}, ${owner.userId}, 'business_info', 'patch', ${linked.googleLocationName}, 'validated', 'interrupted-service', '{"serviceItems":[]}', array['serviceItems'], 'pending', 'pending', ${change.id}) returning id
    `
    google.reset()
    let readFails = true
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => readFails
      ? { status: 403, json: { error: { message: "Readback denied" } } }
      : { status: 200, json: { serviceItems: [] } })
    const check = () => fetch(url, { method: "POST", headers: jsonHeaders(owner.cookie, "interrupted-services-check"), body: JSON.stringify({ mutationId: attempt.id }) })
    const early = await check()
    expect(early.status).toBe(409)
    expect(await early.json()).toMatchObject({ error: "mutation_not_ready" })
    await admin`update gbp_management_mutation set created_at = now() - interval '6 minutes', target_resource_name = 'locations/different' where id = ${attempt.id}`
    const moved = await check()
    expect(moved.status).toBe(409)
    expect(await moved.json()).toMatchObject({ error: "google_target_changed" })
    expect(google.calls).toHaveLength(0)
    await admin`update gbp_management_mutation set target_resource_name = ${linked.googleLocationName} where id = ${attempt.id}`
    const failedRead = await check()
    expect(failedRead.status, await failedRead.clone().text()).toBe(200)
    expect(await failedRead.json()).toMatchObject({ status: "ambiguous", executionState: "unknown", confirmationState: "unresolved" })
    const [unresolved] = await admin`select requested_payload, confirmation_response, confirmation_error_code from gbp_management_mutation where id = ${attempt.id}`
    expect(unresolved.requested_payload).toEqual({ serviceItems: [] })
    expect(unresolved.confirmation_response).toBeNull()
    expect(unresolved.confirmation_error_code).toBeTruthy()
    readFails = false
    const recovered = await check()
    expect(recovered.status).toBe(200)
    expect(await recovered.json()).toMatchObject({ status: "succeeded", executionState: "unknown", confirmationState: "confirmed" })
    expect(google.calls).toHaveLength(2)
    expect(google.calls.every((call) => call.method === "GET")).toBe(true)
    const remainingOwner = await createTestTenant(admin)
    organisations.push(remainingOwner.organisationId)
    await admin`insert into member (organisation_id, user_id, role) values (${owner.organisationId}, ${remainingOwner.userId}, 'owner')`
    await admin`update member set role = 'member', can_publish = true where organisation_id = ${owner.organisationId} and user_id = ${owner.userId}`
    expect((await check()).status).toBe(403)
    await admin`delete from member where organisation_id = ${owner.organisationId} and user_id = ${owner.userId}`
    expect((await check()).status).toBe(401)
    expect(google.calls).toHaveLength(2)
  })

  it("rejects invalid lodging payloads and masks before provider access or attempt creation", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    google.reset()
    for (const change of [
      { updateMask: ["pets"], payload: { pets: { petsAllowed: "false" } } },
      { updateMask: ["*"], payload: {} },
      { updateMask: ["allUnits"], payload: { allUnits: {} } },
      { updateMask: ["pets"], payload: { name: "locations/other/lodging", pets: {} } },
    ]) {
      const response = await fetch(`${server.baseUrl}/api/locations/${linked.locationId}/industry`, {
        method: "PATCH",
        headers: jsonHeaders(owner.cookie, `invalid-lodging-${change.updateMask[0]}`),
        body: JSON.stringify({ operation: "update_lodging", confirmation: "publish_industry_data_to_google", ...change }),
      })
      expect(response.status, await response.clone().text()).toBe(400)
      expect(await response.json()).toMatchObject({ error: "invalid_request" })
    }
    expect(google.calls).toHaveLength(0)
    const attempts = await admin`select id from gbp_management_mutation where organisation_id = ${owner.organisationId}`
    expect(attempts).toHaveLength(0)
  })

  it.each([
    [{}, "eligibility_unknown"],
    [{ canModifyServiceList: false }, "location_ineligible"],
  ])("rejects service writes with metadata %j before creating attempts", async (metadata, code) => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    google.reset()
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: { name: linked.googleLocationName, metadata } }))
    google.respond({ method: "GET", pathIncludes: "/attributes" }, () => ({ status: 200, json: { attributes: [], attributeMetadata: [] } }))
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/business-information`
    const loaded = await fetch(url, { headers: { cookie: owner.cookie } })
    expect(loaded.status, await loaded.clone().text()).toBe(200)
    const state = businessInformationResponseSchema.parse(await loaded.json()).businessInformation
    expect(state.capabilityDetails?.fields.serviceItems).toMatchObject({ canWrite: false, reasonCode: code })
    const serviceChoices = await fetch(`${url}?type=services`, { headers: { cookie: owner.cookie } })
    expect(serviceChoices.status).toBe(409)
    expect(await serviceChoices.json()).toMatchObject({ error: code })

    const response = await fetch(url, {
      method: "PUT",
      headers: jsonHeaders(owner.cookie, `services-${code}`),
      body: JSON.stringify({
        expectedGoogleHash: state.locationHash,
        updateMask: ["serviceItems"],
        payload: { serviceItems: [] },
      }),
    })

    expect(response.status, await response.clone().text()).toBe(409)
    expect(await response.json()).toMatchObject({ error: code })
    expect(google.calls.every((call) => call.method === "GET")).toBe(true)
    const attempts = await admin`
      select id from gbp_management_mutation where organisation_id = ${owner.organisationId}
    `
    expect(attempts).toHaveLength(0)
  })

  it("preserves proto3 midnight through standalone hours initialization and readback", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    google.reset()
    let explicitZeros = false
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => {
      const openTime = explicitZeros ? { hours: 0, minutes: 0 } : {}
      const closeTime = explicitZeros ? { hours: 0, minutes: 30 } : { minutes: 30 }
      const period = { openDay: "MONDAY", closeDay: "MONDAY", openTime, closeTime }
      return { status: 200, json: {
        name: linked.googleLocationName,
        regularHours: { periods: [period] },
        specialHours: { specialHourPeriods: [{ startDate: { year: 2026, month: 12, day: 24 }, openTime, closeTime }] },
        moreHours: [{ hoursTypeId: "DELIVERY", periods: [period] }],
      } }
    })
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/hours`
    const read = async () => {
      const response = await fetch(url, { headers: { cookie: owner.cookie } })
      expect(response.status, await response.clone().text()).toBe(200)
      return hoursResponseSchema.parse(await response.json()).hours
    }
    const first = await read()
    expect(first.google.regular[1]).toEqual({ dayOfWeek: 1, isClosed: false, periods: [{ opensAt: "00:00", closesAt: "00:30" }] })
    expect(first.google.special).toEqual([{ effectiveDate: "2026-12-24", isClosed: false, opensAt: "00:00", closesAt: "00:30" }])
    expect(first.google.moreHours).toEqual([{ hoursTypeId: "DELIVERY", periods: [{ dayOfWeek: 1, opensAt: "00:00", closesAt: "00:30" }] }])
    expect(first.canonical).toEqual(first.google)
    explicitZeros = true
    const second = await read()
    expect(second.google).toEqual(first.google)
    expect(second.googleHash).toBe(first.googleHash)
    expect(second.status).toBe("in_sync")
    expect(google.calls.every((call) => call.method === "GET")).toBe(true)
  })

  it("initializes from Google, supports local CRUD, publishes, and reconciles without a venue mapping", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })

    const providerLocation: Record<string, unknown> = {
      name: linked.googleLocationName,
      title: "Old Crown",
      profile: { description: "Village pub" },
      phoneNumbers: { primaryPhone: "+44 1223 000000", additionalPhones: ["+44 1223 000001", "+44 1223 000002"] },
      websiteUri: "https://old-crown.example",
      regularHours: {
        periods: [{ openDay: "MONDAY", closeDay: "MONDAY", openTime: { hours: 11, minutes: 0 }, closeTime: { hours: 23, minutes: 0 } }],
      },
      specialHours: { specialHourPeriods: [] },
      moreHours: [],
      categories: { primaryCategory: { displayName: "Pub", moreHoursTypes: [{ hoursTypeId: "KITCHEN" }] } },
      metadata: { canHaveFoodMenus: true, mapsUri: "https://maps.example/old-crown", newReviewUri: "https://reviews.example/old-crown" },
    }
    let providerMenus: Array<Record<string, unknown>> = []

    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: providerLocation }))
    google.respond({ method: "PATCH", pathIncludes: `/v1/${linked.googleLocationName}` }, (call) => {
      const url = new URL(call.path, google.baseUrl)
      const body = z.record(z.string(), z.unknown()).parse(call.body)
      const mask = url.searchParams.get("updateMask")?.split(",") ?? []
      if ("phoneNumbers" in body) {
        expect(mask).toContain("phoneNumbers")
        expect(body.phoneNumbers).toEqual({ primaryPhone: "+44 1223 999999", additionalPhones: ["+44 1223 000001", "+44 1223 000002"] })
      }
      if (url.searchParams.get("validateOnly") !== "true") {
        for (const field of mask) {
          providerLocation[field] = body[field]
        }
      }
      return { status: 200, json: providerLocation }
    })
    google.respond({ method: "GET", pathIncludes: "/foodMenus" }, () => ({ status: 200, json: { menus: providerMenus } }))
    google.respond({ method: "PATCH", pathIncludes: "/foodMenus" }, (call) => {
      providerMenus = (call.body as { menus: Array<Record<string, unknown>> }).menus
      return { status: 200, json: { menus: providerMenus } }
    })

    const root = `${server.baseUrl}/api/locations/${linked.locationId}`
    const initialHours = await getJson(`${root}/hours`, owner.cookie, "hours")
    const initialProfile = await getJson(`${root}/profile`, owner.cookie, "profile")
    const initialMenus = await getJson(`${root}/food-menus`, owner.cookie, "foodMenus")
    expect(initialHours.canonicalResource.revision).toBe("1")
    expect(initialHours.status).toBe("in_sync")
    expect(initialProfile.fields.find((field: { key: string }) => field.key === "name").canonicalValue).toBe("Old Crown")
    expect(initialMenus.canonicalMenus).toEqual([])

    const changedHours = structuredClone(initialHours.canonical)
    changedHours.regular[1].periods[0].closesAt = "22:00"
    const saveHours = await fetch(`${root}/hours`, {
      method: "PUT",
      headers: jsonHeaders(owner.cookie, "save-hours"),
      body: JSON.stringify({ expectedCanonicalRevision: "1", hours: changedHours }),
    })
    expect(saveHours.status, await saveHours.clone().text()).toBe(200)
    expect(await saveHours.json()).toMatchObject({ saved: true, revision: "2" })

    const reviewedHours = await getJson(`${root}/hours`, owner.cookie, "hours")
    const publishHours = await fetch(`${root}/hours`, {
      method: "POST",
      headers: jsonHeaders(owner.cookie, "publish-hours"),
      body: JSON.stringify({
        confirmation: "publish_nabapresence_hours_to_google",
        expectedCanonicalRevision: reviewedHours.canonicalResource.revision,
        expectedCanonicalHash: reviewedHours.canonicalHash,
        expectedGoogleHash: reviewedHours.googleHash,
        approvedUpdateMask: reviewedHours.updateMask,
        confirmOverwriteGoogleChanges: false,
      }),
    })
    expect(publishHours.status, await publishHours.clone().text()).toBe(200)
    expect(await publishHours.json()).toMatchObject({ status: "published" })

    const saveProfile = await fetch(`${root}/profile`, {
      method: "PUT",
      headers: jsonHeaders(owner.cookie, "save-profile"),
      body: JSON.stringify({
        expectedCanonicalRevision: initialProfile.canonicalResource.revision,
        values: { name: "The Old Crown", website: "https://the-old-crown.example", phone: "+44 1223 999999" },
      }),
    })
    expect(saveProfile.status, await saveProfile.clone().text()).toBe(200)
    const reviewedProfile = await getJson(`${root}/profile`, owner.cookie, "profile")
    providerLocation.phoneNumbers = { primaryPhone: "+44 1223 000000", additionalPhones: ["+44 1223 000003"] }
    const stalePhoneReview = await fetch(`${root}/profile`, {
      method: "POST", headers: jsonHeaders(owner.cookie, "stale-phone-review"),
      body: JSON.stringify({ direction: "to_google", confirmation: "publish_nabapresence_profile_to_google", selectedFields: ["phone"], expectedCanonicalRevision: reviewedProfile.canonicalResource.revision, expectedCanonicalHash: reviewedProfile.canonicalHash, expectedGoogleHash: reviewedProfile.googleHash, confirmOverwriteGoogleChanges: false, confirmOverwriteCanonicalChanges: false }),
    })
    expect(stalePhoneReview.status, await stalePhoneReview.clone().text()).toBe(409)
    expect(await stalePhoneReview.json()).toMatchObject({ error: "profile_snapshot_stale" })
    expect(providerLocation.phoneNumbers).toEqual({ primaryPhone: "+44 1223 000000", additionalPhones: ["+44 1223 000003"] })
    providerLocation.phoneNumbers = { primaryPhone: "+44 1223 000000", additionalPhones: ["+44 1223 000001", "+44 1223 000002"] }
    const publishProfile = await fetch(`${root}/profile`, {
      method: "POST",
      headers: jsonHeaders(owner.cookie, "publish-profile"),
      body: JSON.stringify({
        direction: "to_google",
        confirmation: "publish_nabapresence_profile_to_google",
        selectedFields: ["name", "website", "phone"],
        expectedCanonicalRevision: reviewedProfile.canonicalResource.revision,
        expectedCanonicalHash: reviewedProfile.canonicalHash,
        expectedGoogleHash: reviewedProfile.googleHash,
        confirmOverwriteGoogleChanges: false,
        confirmOverwriteCanonicalChanges: false,
      }),
    })
    expect(publishProfile.status, await publishProfile.clone().text()).toBe(200)
    expect(providerLocation).toMatchObject({ title: "The Old Crown", websiteUri: "https://the-old-crown.example" })
    expect(providerLocation.phoneNumbers).toEqual({ primaryPhone: "+44 1223 999999", additionalPhones: ["+44 1223 000001", "+44 1223 000002"] })
    const beforePhoneClear = await getJson(`${root}/profile`, owner.cookie, "profile")
    const savePhoneClear = await fetch(`${root}/profile`, { method: "PUT", headers: jsonHeaders(owner.cookie, "save-phone-clear"), body: JSON.stringify({ expectedCanonicalRevision: beforePhoneClear.canonicalResource.revision, values: { phone: null } }) })
    expect(savePhoneClear.status).toBe(200)
    const phoneClearReview = await getJson(`${root}/profile`, owner.cookie, "profile")
    const clearPhone = await fetch(`${root}/profile`, {
      method: "POST", headers: jsonHeaders(owner.cookie, "publish-phone-clear"),
      body: JSON.stringify({ direction: "to_google", confirmation: "publish_nabapresence_profile_to_google", selectedFields: ["phone"], expectedCanonicalRevision: phoneClearReview.canonicalResource.revision, expectedCanonicalHash: phoneClearReview.canonicalHash, expectedGoogleHash: phoneClearReview.googleHash, confirmOverwriteGoogleChanges: false, confirmOverwriteCanonicalChanges: false }),
    })
    expect(clearPhone.status, await clearPhone.clone().text()).toBe(422)
    expect(await clearPhone.json()).toMatchObject({ error: "primary_phone_required" })
    expect(providerLocation.phoneNumbers).toEqual({ primaryPhone: "+44 1223 999999", additionalPhones: ["+44 1223 000001", "+44 1223 000002"] })

    const canonicalMenus = [{
      labels: [{ displayName: "Main", languageCode: "en-GB" }],
      sections: [{
        labels: [{ displayName: "Mains", languageCode: "en-GB" }],
        items: [{
          labels: [{ displayName: "Steak pie", languageCode: "en-GB" }],
          attributes: { price: { currencyCode: "GBP", units: "16", nanos: 0 } },
        }],
      }],
    }]
    const saveMenus = await fetch(`${root}/food-menus`, {
      method: "PUT",
      headers: jsonHeaders(owner.cookie, "save-menus"),
      body: JSON.stringify({ expectedCanonicalRevision: initialMenus.canonicalResource.revision, menus: canonicalMenus }),
    })
    expect(saveMenus.status, await saveMenus.clone().text()).toBe(200)
    const reviewedMenus = await getJson(`${root}/food-menus`, owner.cookie, "foodMenus")
    const publishMenus = await fetch(`${root}/food-menus`, {
      method: "POST",
      headers: jsonHeaders(owner.cookie, "publish-menus"),
      body: JSON.stringify({
        confirmation: "publish_nabapresence_food_menus_to_google",
        expectedCanonicalRevision: reviewedMenus.canonicalResource.revision,
        expectedCanonicalHash: reviewedMenus.canonicalHash,
        expectedGoogleHash: reviewedMenus.googleHash,
        confirmFullReplacement: true,
      }),
    })
    expect(publishMenus.status, await publishMenus.clone().text()).toBe(200)
    expect(providerMenus).toEqual(canonicalMenus)

    const stale = await fetch(`${root}/hours`, {
      method: "PUT",
      headers: jsonHeaders(owner.cookie, "stale-hours"),
      body: JSON.stringify({ expectedCanonicalRevision: "1", hours: changedHours }),
    })
    expect(stale.status).toBe(409)

    const resources = await admin<{ resourceType: string; revision: string }[]>`
      select resource_type as "resourceType", revision::text as revision
      from presence_canonical_resource
      where organisation_id = ${owner.organisationId}
      order by resource_type
    `
    expect(resources).toEqual([
      { resourceType: "food_menus", revision: "2" },
      { resourceType: "hours", revision: "2" },
      { resourceType: "profile", revision: "3" },
    ])
  }, 30_000)
})

async function getJson(url: string, cookie: string, key: string) {
  const response = await fetch(url, { headers: { cookie } })
  expect(response.status, await response.clone().text()).toBe(200)
  return (await response.json())[key]
}

function jsonHeaders(cookie: string, requestId: string) {
  return { cookie, "content-type": "application/json", "x-request-id": requestId }
}
