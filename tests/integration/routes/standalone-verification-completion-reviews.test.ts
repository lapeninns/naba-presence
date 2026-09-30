import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { verificationCompletionReviewResponseSchema } from "@/lib/contracts/google-verification-completion-review"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { createTestTenant, destroyTenants, seedGoogleConnection, seedLinkedReview, seedMemberUser } from "../helpers/tenant"

const suite = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
suite("standalone immutable PIN completion reviews", () => {
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
  async function fixture(method = "EMAIL", state = "PENDING") {
    const owner = await createTestTenant(admin); organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    const name = `${linked.googleLocationName}/verifications/pin-request`
    const verification = { name, method, state, createTime: "2026-09-30T00:00:00Z" }
    google.reset()
    function history(value = verification) {
      google.respond({ method: "GET", pathIncludes: `${linked.googleLocationName}/verifications` }, () => ({ status: 200, json: { verifications: [value] } }))
    }
    history()
    google.respond({ method: "GET", pathEndsWith: `${linked.googleLocationName}/VoiceOfMerchantState` }, () => ({ status: 200, json: { hasVoiceOfMerchant: false, verify: { hasPendingVerification: true } } }))
    const base = `${server.baseUrl}/api/locations/${linked.locationId}/verification-completion-reviews`
    const input = { name, pin: "001234-sensitive-pin" }
    async function preview() {
      const response = await post(base, owner.cookie, input)
      expect(response.status, await response.clone().text()).toBe(200)
      return verificationCompletionReviewResponseSchema.parse(await response.json()).review
    }
    return { owner, linked, connection, verification, input, base, preview, history }
  }
  it.each(["EMAIL", "PHONE_CALL", "SMS", "ADDRESS"])("saves, restores and approves %s without persisting or sending the PIN", async (method) => {
    // Given a current pending request and entered PIN.
    const f = await fixture(method)
    const review = await f.preview(); const url = `${f.base}/${review.changeSet.id}`
    // When the saved review is restored and approved twice.
    const restored = await fetch(url, { headers: { cookie: f.owner.cookie } })
    expect(verificationCompletionReviewResponseSchema.parse(await restored.json()).review).toEqual(review)
    for (let i = 0; i < 2; i++) {
      const response = await post(url, f.owner.cookie, { expectedPayloadHash: review.changeSet.payloadHash })
      expect(response.status, await response.clone().text()).toBe(200)
      expect(verificationCompletionReviewResponseSchema.parse(await response.json()).review.changeSet.approvedBy).toBe(f.owner.userId)
    }
    // Then only the hidden commitment and exact public target are retained.
    expect(review.payload).toMatchObject({ name: f.input.name, method })
    expect(new Date(review.changeSet.expiresAt).getTime() - Date.now()).toBeLessThan(20 * 60_000 + 1000)
    const [row] = await admin`select payload, baseline, private_payload from gbp_change_set where id = ${review.changeSet.id}`
    expect(JSON.stringify(row)).not.toContain(f.input.pin)
    expect(Buffer.isBuffer(row?.private_payload)).toBe(true)
    const audit = await admin`select metadata from audit_log where organisation_id = ${f.owner.organisationId}`
    expect(JSON.stringify({ review, audit })).not.toContain(f.input.pin)
    expect(google.calls.filter((call) => call.method === "POST")).toHaveLength(0)
    expect(await admin`select id from gbp_management_mutation where organisation_id = ${f.owner.organisationId}`).toHaveLength(0)
  }, 30_000)
  it.each(["COMPLETED", "FAILED", "STATE_UNSPECIFIED"])("refuses a %s request before saving a review", async (state) => {
    const f = await fixture("EMAIL", state)
    const response = await post(f.base, f.owner.cookie, f.input)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: "verification_not_pending" })
    expect(await admin`select id from gbp_change_set where organisation_id = ${f.owner.organisationId}`).toHaveLength(0)
  })
  it.each(["AUTO", "VETTED_PARTNER", "FUTURE_METHOD"])("hands off %s instead of accepting a PIN review", async (method) => {
    const f = await fixture(method)
    const response = await post(f.base, f.owner.cookie, f.input)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: "verification_external_method" })
    expect(await admin`select id from gbp_change_set where organisation_id = ${f.owner.organisationId}`).toHaveLength(0)
  })
  it.each(["expiry", "policy", "cipher", "payload", "target", "generation", "phase", "method"])("blocks %s drift before approval", async (kind) => {
    const f = await fixture(); const review = await f.preview()
    if (kind === "expiry") await admin`update gbp_change_set set approval_expires_at = now() - interval '1 minute' where id = ${review.changeSet.id}`
    if (kind === "policy") await admin`update organisation set require_two_person_approval = true where id = ${f.owner.organisationId}`
    if (kind === "cipher") await admin`update gbp_change_set set private_payload = ${Buffer.alloc(32)} where id = ${review.changeSet.id}`
    if (kind === "payload") await admin`update gbp_change_set set payload = payload || '{"name":"locations/foreign/verifications/pin-request"}'::jsonb where id = ${review.changeSet.id}`
    if (kind === "target") await admin`update external_location set google_location_name = 'locations/new-target' where id = ${f.linked.externalLocationId}`
    if (kind === "generation") await admin`update google_connection set credential_generation = credential_generation + 1 where id = ${f.connection.connectionId}`
    if (kind === "phase") f.history({ ...f.verification, state: "COMPLETED" })
    if (kind === "method") f.history({ ...f.verification, method: "SMS" })
    const response = await post(`${f.base}/${review.changeSet.id}`, f.owner.cookie, { expectedPayloadHash: review.changeSet.payloadHash })
    expect(response.status, await response.clone().text()).toBe(409)
    expect((await admin`select approved_by from gbp_change_set where id = ${review.changeSet.id}`)[0]?.approved_by).toBeNull()
  }, 30_000)
  it("requires a different current manager under the two-person policy", async () => {
    const f = await fixture(); await admin`update organisation set require_two_person_approval = true where id = ${f.owner.organisationId}`
    const review = await f.preview(); const url = `${f.base}/${review.changeSet.id}`
    expect((await post(url, f.owner.cookie, { expectedPayloadHash: review.changeSet.payloadHash })).status).toBe(409)
    const second = await seedMemberUser(admin, { organisationId: f.owner.organisationId })
    await admin`update member set role = 'admin', can_publish = true where user_id = ${second.userId}`
    const response = await post(url, second.cookie, { expectedPayloadHash: review.changeSet.payloadHash })
    expect(response.status, await response.clone().text()).toBe(200)
    expect(verificationCompletionReviewResponseSchema.parse(await response.json()).review.changeSet.approvedBy).toBe(second.userId)
  }, 30_000)
  it("rejects a foreign verification and extra inputs without provider reads", async () => {
    const f = await fixture(); const before = google.calls.length
    expect((await post(f.base, f.owner.cookie, { ...f.input, name: "locations/foreign/verifications/pin-request" })).status).toBe(400)
    expect((await post(f.base, f.owner.cookie, { ...f.input, method: "EMAIL" })).status).toBe(400)
    expect(google.calls).toHaveLength(before)
  })
  it("rejects a wrong approval hash before provider reads", async () => {
    const f = await fixture(); const review = await f.preview(); const before = google.calls.length
    expect((await post(`${f.base}/${review.changeSet.id}`, f.owner.cookie, { expectedPayloadHash: "f".repeat(64) })).status).toBe(409)
    expect(google.calls).toHaveLength(before)
  })
  it("hides reviews from other tenants and viewers", async () => {
    const f = await fixture(); const review = await f.preview(); const url = `${f.base}/${review.changeSet.id}`
    const foreign = await createTestTenant(admin); organisations.push(foreign.organisationId)
    expect((await fetch(url, { headers: { cookie: foreign.cookie } })).status).toBe(404)
    const viewer = await seedMemberUser(admin, { organisationId: f.owner.organisationId, role: "viewer" })
    expect((await fetch(url, { headers: { cookie: viewer.cookie } })).status).toBe(403)
  })
  it("refuses approval after the Google connection is revoked", async () => {
    const f = await fixture(); const review = await f.preview()
    await admin`update google_connection set status = 'revoked' where id = ${f.connection.connectionId}`
    const response = await post(`${f.base}/${review.changeSet.id}`, f.owner.cookie, { expectedPayloadHash: review.changeSet.payloadHash })
    expect(response.status).toBe(409)
    expect((await admin`select approved_by from gbp_change_set where id = ${review.changeSet.id}`)[0]?.approved_by).toBeNull()
  })
  it("refuses approval if the initiating manager loses access", async () => {
    const f = await fixture()
    const initiator = await seedMemberUser(admin, { organisationId: f.owner.organisationId })
    await admin`update member set role = 'admin', can_publish = true where user_id = ${initiator.userId}`
    const preview = await post(f.base, initiator.cookie, f.input)
    expect(preview.status).toBe(200)
    const review = verificationCompletionReviewResponseSchema.parse(await preview.json()).review
    await admin`update member set role = 'viewer', can_publish = false where user_id = ${initiator.userId}`
    const response = await post(`${f.base}/${review.changeSet.id}`, f.owner.cookie, { expectedPayloadHash: review.changeSet.payloadHash })
    expect(response.status).toBe(409)
    expect((await admin`select approved_by from gbp_change_set where id = ${review.changeSet.id}`)[0]?.approved_by).toBeNull()
  })
  it("keeps private bytes immutable and rejects plaintext PIN insertion for the runtime role", async () => {
    const f = await fixture(); const review = await f.preview(); const url = process.env.TEST_RUNTIME_DATABASE_URL
    if (!url) throw new Error("Runtime database required")
    const runtime = postgres(url, { max: 1 })
    try {
      await expect(runtime.begin(async (sql) => {
        await sql`select set_config('app.organisation_id', ${f.owner.organisationId}, true)`
        await sql`update gbp_change_set set private_payload = ${Buffer.alloc(32)} where id = ${review.changeSet.id}`
      })).rejects.toMatchObject({ code: "42501" })
      await expect(runtime.begin(async (sql) => {
        await sql`select set_config('app.organisation_id', ${f.owner.organisationId}, true)`
        await sql`insert into gbp_change_set (organisation_id, location_id, google_account_id, connection_id, target_resource_name, resource_type, requested_by, payload, payload_hash, update_mask, baseline, baseline_hash, require_two_person_approval, private_payload)
          select organisation_id, location_id, google_account_id, connection_id, target_resource_name, resource_type, requested_by, payload || '{"pin":"secret"}'::jsonb, payload_hash, update_mask, baseline, baseline_hash, require_two_person_approval, private_payload from gbp_change_set where id = ${review.changeSet.id}`
      })).rejects.toMatchObject({ code: "23514" })
    } finally { await runtime.end() }
  })
})
