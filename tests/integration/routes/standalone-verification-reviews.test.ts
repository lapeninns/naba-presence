import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { verificationOptionsResponseSchema, verificationStartPayloadSchema } from "@/lib/contracts/google-verification-options"
import { verificationReviewResponseSchema } from "@/lib/contracts/google-verification-review"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { createTestTenant, destroyTenants, seedGoogleConnection, seedLinkedReview, seedMemberUser } from "../helpers/tenant"

const suite = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
const address = { regionCode: "GB", addressLines: ["private-service-review-address"], locality: "London", postalCode: "SW1A 1AA" }
suite("standalone immutable verification start reviews", () => {
  let admin: ReturnType<typeof postgres>, google: GoogleStub, server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  beforeAll(async () => {
    const url = process.env.DIRECT_DATABASE_URL
    if (!url) throw new Error("DIRECT_DATABASE_URL required")
    admin = postgres(url, { max: 1 }); google = await startGoogleStub()
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl, GBP_PROFILE_WRITES_ENABLED: "true", PUBLISH_ENABLED: "true" })
  })
  afterAll(async () => { await server.stop(); await google.stop(); await destroyTenants(admin, organisations); await admin.end() })
  function post(url: string, cookie: string, body: unknown) { return fetch(url, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }) }
  async function fixture(service = false) {
    const owner = await createTestTenant(admin); organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    google.reset()
    google.respond({ method: "GET", pathIncludes: `${linked.googleLocationName}/verifications` }, () => ({ status: 200, json: { verifications: [] } }))
    google.respond({ method: "GET", pathEndsWith: `${linked.googleLocationName}/VoiceOfMerchantState` }, () => ({ status: 200, json: { hasVoiceOfMerchant: false, verify: { hasPendingVerification: false } } }))
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: { name: linked.googleLocationName, serviceArea: { businessType: service ? "CUSTOMER_LOCATION_ONLY" : "CUSTOMER_AND_BUSINESS_LOCATION" } } }))
    google.respond({ method: "POST", pathEndsWith: `${linked.googleLocationName}:fetchVerificationOptions` }, () => ({ status: 200, json: { options: service ? [{ verificationMethod: "ADDRESS", addressData: { business: "Service business", address } }] : [{ verificationMethod: "EMAIL", emailData: { user: "owner", domain: "example.test", isUserNameEditable: false } }] } }))
    const base = `${server.baseUrl}/api/locations/${linked.locationId}`
    const payload = verificationStartPayloadSchema.parse(service ? { method: "ADDRESS", languageCode: "en", mailerContact: "Owner", context: { address } } : { method: "EMAIL", languageCode: "en", emailAddress: "owner@example.test" })
    const optionsResponse = await post(`${base}/verification-options`, owner.cookie, { languageCode: payload.languageCode, context: payload.context })
    expect(optionsResponse.status).toBe(200)
    const option = verificationOptionsResponseSchema.parse(await optionsResponse.json()).options[0]
    if (!option) throw new Error("Fixture option missing")
    const input = { optionId: option.id, payload }
    async function preview() {
      const response = await post(`${base}/verification-reviews`, owner.cookie, input)
      expect(response.status, await response.clone().text()).toBe(200)
      return verificationReviewResponseSchema.parse(await response.json()).review
    }
    return { owner, linked, base, input, preview }
  }
  it("saves, restores and idempotently approves an exact review without verifying Google", async () => {
    const f = await fixture(); const review = await f.preview(); const url = `${f.base}/verification-reviews/${review.changeSet.id}`
    expect(review.changeSet.approvedBy).toBeNull()
    expect(new Date(review.changeSet.expiresAt).getTime() - Date.now()).toBeLessThan(20 * 60_000 + 1000)
    const loaded = await fetch(url, { headers: { cookie: f.owner.cookie } })
    expect(verificationReviewResponseSchema.parse(await loaded.json()).review).toEqual(review)
    for (let i = 0; i < 2; i++) {
      const approved = await post(url, f.owner.cookie, { expectedPayloadHash: review.changeSet.payloadHash })
      expect(approved.status, await approved.clone().text()).toBe(200)
      expect(verificationReviewResponseSchema.parse(await approved.json()).review.changeSet.approvedBy).toBe(f.owner.userId)
    }
    expect(google.calls.filter((call) => call.path.endsWith(":verify"))).toHaveLength(0)
    expect(await admin`select id from gbp_management_mutation where organisation_id = ${f.owner.organisationId}`).toHaveLength(0)
  }, 30_000)
  it("encrypts both private context and Google's postal choice, then restores the exact proposal", async () => {
    const f = await fixture(true); const review = await f.preview()
    const [row] = await admin`select payload, baseline, private_payload from gbp_change_set where id = ${review.changeSet.id}`
    expect(JSON.stringify({ payload: row?.payload, baseline: row?.baseline })).not.toContain(address.addressLines[0])
    expect(Buffer.isBuffer(row?.private_payload)).toBe(true)
    expect(row?.private_payload.toString("utf8")).not.toContain(address.addressLines[0])
    const audit = await admin`select metadata from audit_log where organisation_id = ${f.owner.organisationId}`
    expect(JSON.stringify(audit)).not.toContain(address.addressLines[0])
    const response = await fetch(`${f.base}/verification-reviews/${review.changeSet.id}`, { headers: { cookie: f.owner.cookie } })
    expect(verificationReviewResponseSchema.parse(await response.json()).review.payload).toEqual(f.input.payload)
    expect(review.choice).toMatchObject({ kind: "address", address })
  })
  it("requires another current manager under the two-person policy", async () => {
    const f = await fixture(); await admin`update organisation set require_two_person_approval = true where id = ${f.owner.organisationId}`
    const review = await f.preview(); const url = `${f.base}/verification-reviews/${review.changeSet.id}`
    expect(review.changeSet.canApprove).toBe(false)
    expect((await post(url, f.owner.cookie, { expectedPayloadHash: review.changeSet.payloadHash })).status).toBe(409)
    const second = await seedMemberUser(admin, { organisationId: f.owner.organisationId })
    await admin`update member set role = 'admin', can_publish = true where user_id = ${second.userId}`
    const approved = await post(url, second.cookie, { expectedPayloadHash: review.changeSet.payloadHash })
    expect(approved.status, await approved.clone().text()).toBe(200)
    expect(verificationReviewResponseSchema.parse(await approved.json()).review.changeSet.approvedBy).toBe(second.userId)
  }, 30_000)
  it.each(["expiry", "policy", "cipher", "payload", "target"])("rejects %s changes before recording approval", async (kind) => {
    const f = await fixture(); const review = await f.preview()
    if (kind === "expiry") await admin`update gbp_change_set set approval_expires_at = now() - interval '1 minute' where id = ${review.changeSet.id}`
    if (kind === "policy") await admin`update organisation set require_two_person_approval = true where id = ${f.owner.organisationId}`
    if (kind === "cipher") await admin`update gbp_change_set set private_payload = ${Buffer.alloc(32)} where id = ${review.changeSet.id}`
    if (kind === "payload") await admin`update gbp_change_set set payload = payload || '{"emailAddress":"changed@example.test"}'::jsonb where id = ${review.changeSet.id}`
    if (kind === "target") await admin`update external_location set google_location_name = 'locations/changed-target' where id = ${f.linked.externalLocationId}`
    const response = await post(`${f.base}/verification-reviews/${review.changeSet.id}`, f.owner.cookie, { expectedPayloadHash: review.changeSet.payloadHash })
    expect(response.status, await response.clone().text()).toBe(409)
    expect((await admin`select approved_by from gbp_change_set where id = ${review.changeSet.id}`)[0]?.approved_by).toBeNull()
  })
  it("rechecks the provider's eligible destination and refuses a stale choice", async () => {
    const f = await fixture(); const review = await f.preview()
    google.respond({ method: "POST", pathEndsWith: `${f.linked.googleLocationName}:fetchVerificationOptions` }, () => ({ status: 200, json: { options: [{ verificationMethod: "EMAIL", emailData: { user: "different", domain: "example.test", isUserNameEditable: false } }] } }))
    const response = await post(`${f.base}/verification-reviews/${review.changeSet.id}`, f.owner.cookie, { expectedPayloadHash: review.changeSet.payloadHash })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: "verification_option_changed" })
  })
  it("rejects changed input rather than silently selecting an eligible destination", async () => {
    const f = await fixture()
    const response = await post(`${f.base}/verification-reviews`, f.owner.cookie, { ...f.input, payload: { ...f.input.payload, emailAddress: "different@example.test" } })
    expect(response.status).toBe(409)
    expect(await admin`select id from gbp_change_set where organisation_id = ${f.owner.organisationId}`).toHaveLength(0)
  })
  it("rejects a wrong review hash before provider discovery", async () => {
    const f = await fixture(); const review = await f.preview(); const before = google.calls.length
    expect((await post(`${f.base}/verification-reviews/${review.changeSet.id}`, f.owner.cookie, { expectedPayloadHash: "f".repeat(64) })).status).toBe(409)
    expect(google.calls).toHaveLength(before)
  })
  it("does not reveal a review to another tenant or to a viewer", async () => {
    const f = await fixture(); const review = await f.preview(); const url = `${f.base}/verification-reviews/${review.changeSet.id}`
    const foreign = await createTestTenant(admin); organisations.push(foreign.organisationId)
    expect((await fetch(url, { headers: { cookie: foreign.cookie } })).status).toBe(404)
    const viewer = await seedMemberUser(admin, { organisationId: f.owner.organisationId, role: "viewer" })
    expect((await fetch(url, { headers: { cookie: viewer.cookie } })).status).toBe(403)
  })
  it("keeps encrypted review data immutable for the tenant runtime role", async () => {
    const f = await fixture(); const review = await f.preview(); const url = process.env.TEST_RUNTIME_DATABASE_URL
    if (!url) throw new Error("Runtime database required")
    const runtime = postgres(url, { max: 1 })
    try { await expect(runtime.begin(async (sql) => {
      await sql`select set_config('app.organisation_id', ${f.owner.organisationId}, true)`
      await sql`update gbp_change_set set private_payload = ${Buffer.alloc(32)} where id = ${review.changeSet.id}`
    })).rejects.toMatchObject({ code: "42501" }) } finally { await runtime.end() }
  })
})
