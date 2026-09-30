import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { verificationOptionsResponseSchema } from "@/lib/contracts/google-verification-options"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { createTestTenant, destroyTenants, seedGoogleConnection, seedLinkedReview } from "../helpers/tenant"

const describeDatabase = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
const address = { regionCode: "GB", addressLines: ["fixture-private-verification-address"], locality: "London", postalCode: "SW1A 1AA" }

describeDatabase("standalone typed verification option discovery", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    const databaseUrl = process.env.DIRECT_DATABASE_URL
    if (!databaseUrl) throw new Error("DIRECT_DATABASE_URL is required")
    admin = postgres(databaseUrl, { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl, GBP_PROFILE_WRITES_ENABLED: "false", PUBLISH_ENABLED: "false" })
  })

  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function fixture(role: "owner" | "admin" | "member" | "viewer" = "owner") {
    const owner = await createTestTenant(admin, { role, canPublish: false })
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    google.reset()
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: { name: linked.googleLocationName, serviceArea: { businessType: "CUSTOMER_AND_BUSINESS_LOCATION" } } }))
    google.respond({ method: "POST", pathEndsWith: `${linked.googleLocationName}:fetchVerificationOptions` }, () => ({ status: 200, json: { options: [{ verificationMethod: "AUTO" }] } }))
    return { owner, linked, url: `${server.baseUrl}/api/locations/${linked.locationId}/verification-options` }
  }

  function post(url: string, cookie: string, payload: unknown) {
    return fetch(url, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(payload) })
  }

  it.each(["owner", "admin"] as const)("allows %s read-only discovery while publishing is paused", async (role) => {
    const { owner, linked, url } = await fixture(role)
    const response = await fetch(url, { headers: { cookie: owner.cookie } })
    expect(response.status, await response.clone().text()).toBe(200)
    const result = verificationOptionsResponseSchema.parse(await response.json())
    expect(result).toMatchObject({ locationId: linked.locationId, googleLocationName: linked.googleLocationName, languageCode: "en", customerLocationOnly: false, contextProvided: false, options: [{ kind: "auto", method: "AUTO" }] })
    expect(google.calls[0]?.path).toContain("readMask=name%2CserviceArea")
    expect(google.calls[1]?.body).toEqual({ languageCode: "en" })
    expect(google.calls.filter((call) => call.path.endsWith(":verify") || call.path.endsWith(":complete"))).toHaveLength(0)
  })

  it("preserves multiple destinations, duplicate identity, fixed/unknown email policy and external methods", async () => {
    const { owner, linked, url } = await fixture()
    const phone = { verificationMethod: "SMS", phoneNumber: "+44 20 0000 0001" }
    google.respond({ method: "POST", pathEndsWith: `${linked.googleLocationName}:fetchVerificationOptions` }, () => ({ status: 200, json: { options: [phone, { ...phone, phoneNumber: "+44 20 0000 0002" }, phone, { verificationMethod: "EMAIL", emailData: { user: "owner", domain: "example.test" } }, { verificationMethod: "VETTED_PARTNER", announcement: "private partner statement" }, { verificationMethod: "VIDEO" }] } }))
    const first = await post(url, owner.cookie, { languageCode: "en-GB" })
    expect(first.status).toBe(200)
    const result = verificationOptionsResponseSchema.parse(await first.json())
    expect(result.options).toHaveLength(5)
    expect(result.options.filter((option) => option.kind === "phone").map((option) => option.phoneNumber)).toEqual([phone.phoneNumber, "+44 20 0000 0002"])
    expect(result.options[2]).toMatchObject({ kind: "email", userNameEditable: null })
    expect(result.options[3]).toMatchObject({ kind: "external", reason: "partner_required" })
    expect(result.options[4]).toMatchObject({ kind: "external", reason: "unknown_method" })
    expect(JSON.stringify(result)).not.toContain("private partner statement")
    const second = await post(url, owner.cookie, { languageCode: "en-GB" })
    expect(verificationOptionsResponseSchema.parse(await second.json()).options.map((option) => option.id)).toEqual(result.options.map((option) => option.id))
    const changed = await post(url, owner.cookie, { languageCode: "cy" })
    expect(verificationOptionsResponseSchema.parse(await changed.json()).options[0]?.id).not.toBe(result.options[0]?.id)
  })

  it("uses a private service verification address transiently and binds choices to that context", async () => {
    const { owner, linked, url } = await fixture()
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: { name: linked.googleLocationName, serviceArea: { businessType: "CUSTOMER_LOCATION_ONLY" } } }))
    const payload = { languageCode: "en", context: { address } }
    const response = await post(url, owner.cookie, payload)
    expect(response.status).toBe(200)
    const result = verificationOptionsResponseSchema.parse(await response.json())
    expect(result).toMatchObject({ customerLocationOnly: true, contextProvided: true })
    expect(google.calls[1]?.body).toEqual(payload)
    expect(JSON.stringify(result)).not.toContain(address.addressLines[0])
    const changed = await post(url, owner.cookie, { ...payload, context: { address: { ...address, addressLines: ["different private verification address"] } } })
    const next = verificationOptionsResponseSchema.parse(await changed.json())
    expect(next.contextHash).not.toBe(result.contextHash)
    expect(next.options[0]?.id).not.toBe(result.options[0]?.id)
    const rows = await admin`select requested_payload as value from gbp_management_mutation where organisation_id = ${owner.organisationId}
      union all select payload from gbp_resource_snapshot where organisation_id = ${owner.organisationId}
      union all select metadata from audit_log where organisation_id = ${owner.organisationId}`
    expect(JSON.stringify(rows)).not.toContain(address.addressLines[0])
    expect(server.stdout + server.stderr).not.toContain(address.addressLines[0])
  })

  it.each(["CUSTOMER_AND_BUSINESS_LOCATION", "SERVICE_AREA_BUSINESS_TYPE_UNSPECIFIED", "FUTURE_TYPE", "absent"])("rejects private context for %s before option discovery", async (businessType) => {
    const { owner, linked, url } = await fixture()
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: { name: linked.googleLocationName, ...(businessType === "absent" ? {} : { serviceArea: { businessType } }) } }))
    const response = await post(url, owner.cookie, { context: { address } })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: "verification_context_not_allowed" })
    expect(google.calls).toHaveLength(1)
  })

  it("preserves unknown business type without asserting ineligibility", async () => {
    const { owner, linked, url } = await fixture()
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: { name: linked.googleLocationName } }))
    const response = await fetch(url, { headers: { cookie: owner.cookie } })
    expect(response.status).toBe(200)
    expect(verificationOptionsResponseSchema.parse(await response.json()).customerLocationOnly).toBeNull()
  })

  it.each(["member", "viewer"] as const)("rejects %s before Google discovery", async (role) => {
    const { owner, url } = await fixture(role)
    expect((await fetch(url, { headers: { cookie: owner.cookie } })).status).toBe(403)
    expect((await post(url, owner.cookie, {})).status).toBe(403)
    expect(google.calls).toHaveLength(0)
  })

  it("rejects foreign tenant targets without contacting Google", async () => {
    const { url } = await fixture()
    const foreign = await createTestTenant(admin)
    organisations.push(foreign.organisationId)
    const response = await post(url, foreign.cookie, {})
    expect(response.status).toBe(404)
    expect(google.calls).toHaveLength(0)
  })

  it.each([{ languageCode: "invalid_language" }, { context: { address: { regionCode: "GB" } } }, { context: { address: { ...address, pin: "not allowed" } } }, { organisationId: "client-authority" }])("rejects invalid input before provider calls", async (payload) => {
    const { owner, url } = await fixture()
    expect((await post(url, owner.cookie, payload)).status).toBe(400)
    expect(google.calls).toHaveLength(0)
  })

  it.each([[], { options: [{}] }, { options: "bad" }])("rejects unreadable option results without inventing an empty choice set", async (json) => {
    const { owner, linked, url } = await fixture()
    google.respond({ method: "POST", pathEndsWith: `${linked.googleLocationName}:fetchVerificationOptions` }, () => ({ status: 200, json }))
    const response = await post(url, owner.cookie, {})
    expect(response.status).toBe(502)
  })

  it("keeps an unusable known destination visible as an external handoff", async () => {
    const { owner, linked, url } = await fixture()
    google.respond({ method: "POST", pathEndsWith: `${linked.googleLocationName}:fetchVerificationOptions` }, () => ({ status: 200, json: { options: [{ verificationMethod: "EMAIL" }, { verificationMethod: "SMS", phoneNumber: "****" }] } }))
    const response = await post(url, owner.cookie, {})
    expect(response.status).toBe(200)
    expect(verificationOptionsResponseSchema.parse(await response.json()).options.map((option) => option.kind)).toEqual(["external", "external"])
  })

  it("rejects the wrong provider resource before requesting any options", async () => {
    const { owner, linked, url } = await fixture()
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: { name: "locations/foreign" } }))
    expect((await post(url, owner.cookie, {})).status).toBe(502)
    expect(google.calls).toHaveLength(1)
  })

  it("does not echo private context in provider rejection messages", async () => {
    const { owner, linked, url } = await fixture()
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: { name: linked.googleLocationName, serviceArea: { businessType: "CUSTOMER_LOCATION_ONLY" } } }))
    google.respond({ method: "POST", pathEndsWith: `${linked.googleLocationName}:fetchVerificationOptions` }, () => ({ status: 400, json: { error: { status: "INVALID_ARGUMENT", message: address.addressLines[0] } } }))
    const response = await post(url, owner.cookie, { context: { address } })
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain(address.addressLines[0])
    expect(server.stdout + server.stderr).not.toContain(address.addressLines[0])
  })
})
