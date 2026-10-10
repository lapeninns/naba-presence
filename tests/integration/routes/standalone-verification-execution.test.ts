import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { verificationAttemptResponseSchema } from "@/lib/contracts/google-verification-attempt"
import { verificationReviewResponseSchema } from "@/lib/contracts/google-verification-review"
import { verificationOptionsResponseSchema } from "@/lib/contracts/google-verification-options"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { createTestTenant, destroyTenants, seedGoogleConnection, seedLinkedReview, seedMemberUser } from "../helpers/tenant"

const suite = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
suite("standalone approved verification single-send execution", () => {
  let admin: ReturnType<typeof postgres>, google: GoogleStub, server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  beforeAll(async () => {
    const url = process.env.DIRECT_DATABASE_URL
    if (!url) throw new Error("Disposable database required")
    admin = postgres(url, { max: 1 }); google = await startGoogleStub()
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl, GBP_PROFILE_WRITES_ENABLED: "true", PUBLISH_ENABLED: "true" })
  })
  afterAll(async () => { await server.stop(); await google.stop(); await destroyTenants(admin, organisations); await admin.end() })
  function send(url: string, cookie: string, body: unknown, method = "POST") { return fetch(url, { method, headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }) }
  async function fixture(method: "EMAIL" | "SMS" | "PHONE_CALL" | "ADDRESS" | "AUTO" = "EMAIL", approve = true, twoPerson = false, standing: "clear" | "pending" | "standing" | "unknown" | "waiting" = "clear") {
    const owner = await createTestTenant(admin); organisations.push(owner.organisationId)
    const approver = twoPerson ? await seedMemberUser(admin, { organisationId: owner.organisationId }) : owner
    if (twoPerson) {
      await admin`update member set role = 'admin', can_publish = true where user_id = ${approver.userId}`
      await admin`update organisation set require_two_person_approval = true where id = ${owner.organisationId}`
    }
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    const address = { regionCode: "GB", addressLines: ["private-execution-service-address"], locality: "London", postalCode: "SW1A 1AA" }
    const name = `${linked.googleLocationName}/verifications/request`
    let applied = standing === "pending"
    google.reset()
    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: { name: linked.googleLocationName, serviceArea: { businessType: method === "ADDRESS" ? "CUSTOMER_LOCATION_ONLY" : "CUSTOMER_AND_BUSINESS_LOCATION" } } }))
    const option = method === "EMAIL" ? { verificationMethod: method, emailData: { user: "owner", domain: "example.test", isUserNameEditable: false } }
      : method === "ADDRESS" ? { verificationMethod: method, addressData: { business: "Service business", address } }
      : method === "AUTO" ? { verificationMethod: method } : { verificationMethod: method, phoneNumber: "+44 20 0000 0001" }
    google.respond({ method: "POST", pathEndsWith: `${linked.googleLocationName}:fetchVerificationOptions` }, () => ({ status: 200, json: { options: [option] } }))
    google.respond({ method: "GET", pathIncludes: `${linked.googleLocationName}/verifications` }, () => ({ status: 200, json: { verifications: applied ? [{ name, method, state: "PENDING" }] : [] } }))
    google.respond({ method: "GET", pathEndsWith: `${linked.googleLocationName}/VoiceOfMerchantState` }, () => ({ status: 200, json: standing === "standing" ? { hasVoiceOfMerchant: true }
      : standing === "unknown" ? {} : standing === "waiting" ? { hasVoiceOfMerchant: false, waitForVoiceOfMerchant: {} }
      : { hasVoiceOfMerchant: false, verify: { hasPendingVerification: applied } } }))
    google.respond({ method: "POST", pathEndsWith: `${linked.googleLocationName}:verify` }, () => { applied = true; return { status: 200, json: { verification: { name, method, state: "PENDING", pin: "private-response-echo" }, token: "private-response-echo", context: address } } })
    const base = `${server.baseUrl}/api/locations/${linked.locationId}`
    const payload = { method, languageCode: "en", ...(method === "EMAIL" ? { emailAddress: "owner@example.test" } : method === "SMS" || method === "PHONE_CALL" ? { phoneNumber: "+44 20 0000 0001" } : method === "ADDRESS" ? { mailerContact: "Owner", context: { address } } : {}) }
    const options = verificationOptionsResponseSchema.parse(await (await send(`${base}/verification-options`, owner.cookie, { languageCode: "en", ...(method === "ADDRESS" ? { context: { address } } : {}) })).json())
    const first = options.options[0]
    if (!first) throw new Error("Fixture choice missing")
    const preview = await send(`${base}/verification-reviews`, owner.cookie, { optionId: first.id, payload })
    expect(preview.status, await preview.clone().text()).toBe(200)
    const review = verificationReviewResponseSchema.parse(await preview.json()).review
    if (approve) expect((await send(`${base}/verification-reviews/${review.changeSet.id}`, approver.cookie, { expectedPayloadHash: review.changeSet.payloadHash })).status).toBe(200)
    const url = `${base}/verification-reviews/${review.changeSet.id}/execute`
    const body = { expectedPayloadHash: review.changeSet.payloadHash, confirmation: "start_google_location_verification" }
    return { owner, approver, connection, linked, review, url, body, payload, name, address, execute: () => send(url, owner.cookie, body), refresh: () => send(url, owner.cookie, {}, "PATCH") }
  }
  function writes() { return google.calls.filter((call) => call.path.endsWith(":verify")) }
  it.each(["EMAIL", "SMS", "PHONE_CALL", "ADDRESS", "AUTO"] as const)("sends reviewed %s input once and confirms request identity independently", async (method) => {
    const f = await fixture(method); const response = await f.execute()
    expect(response.status, await response.clone().text()).toBe(200)
    const result = verificationAttemptResponseSchema.parse(await response.json()).attempt
    expect(result).toMatchObject({ reviewId: f.review.changeSet.id, status: "succeeded", executionState: "accepted", confirmationState: "confirmed", idempotent: false, verification: { name: f.name, phase: "pending" }, merchant: { hasVoiceOfMerchant: false } })
    expect(writes()).toHaveLength(1); expect(writes()[0]?.body).toEqual(f.payload)
    const replay = verificationAttemptResponseSchema.parse(await (await f.execute()).json()).attempt
    expect(replay).toMatchObject({ id: result.id, idempotent: true })
    expect(writes()).toHaveLength(1)
    const rows = await admin`select requested_payload, google_response, confirmation_response from gbp_management_mutation where id = ${result.id}`
    expect(JSON.stringify(rows)).not.toContain(f.address.addressLines[0])
    expect(JSON.stringify(rows)).not.toContain("private-response-echo")
    expect(JSON.stringify(result)).not.toContain("private-response-echo")
    const [settled] = await admin`select finished_at from gbp_management_mutation where id = ${result.id}`
    expect(settled?.finished_at).toBeInstanceOf(Date)
  }, 30_000)
  it.each(["unapproved", "hash", "expiry", "policy", "generation", "choice", "history", "actor"])("blocks %s before a provider mutation", async (kind) => {
    const f = await fixture("EMAIL", kind !== "unapproved")
    if (kind === "expiry") await admin`update gbp_change_set set approval_expires_at = now() - interval '1 minute' where id = ${f.review.changeSet.id}`
    if (kind === "policy") await admin`update organisation set require_two_person_approval = true where id = ${f.owner.organisationId}`
    if (kind === "generation") await admin`update google_connection set credential_generation = credential_generation + 1 where id = ${f.connection.connectionId}`
    if (kind === "choice") google.respond({ method: "POST", pathEndsWith: `${f.linked.googleLocationName}:fetchVerificationOptions` }, () => ({ status: 200, json: { options: [{ verificationMethod: "AUTO" }] } }))
    if (kind === "history") google.respond({ method: "GET", pathIncludes: `${f.linked.googleLocationName}/verifications` }, () => ({ status: 200, json: { verifications: [{ name: f.name, method: "EMAIL", state: "FAILED" }] } }))
    if (kind === "actor") {
      const retained = await seedMemberUser(admin, { organisationId: f.owner.organisationId }); await admin`update member set role = 'owner' where user_id = ${retained.userId}`
      await admin`update member set role = 'viewer' where user_id = ${f.owner.userId}`
    }
    const response = await send(f.url, f.owner.cookie, kind === "hash" ? { ...f.body, expectedPayloadHash: "f".repeat(64) } : f.body)
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(writes()).toHaveLength(0)
    expect(await admin`select id from gbp_management_mutation where organisation_id = ${f.owner.organisationId}`).toHaveLength(0)
  }, 30_000)
  it("retains a definitive provider rejection and never resends that review", async () => {
    const f = await fixture()
    google.respond({ method: "POST", pathEndsWith: `${f.linked.googleLocationName}:verify` }, () => ({ status: 400, json: { error: { status: "INVALID_ARGUMENT", message: "private-rejection-echo" } } }))
    const response = await f.execute(); expect(response.status).toBe(200)
    expect(verificationAttemptResponseSchema.parse(await response.json()).attempt).toMatchObject({ status: "failed", executionState: "rejected", confirmationState: "unrecorded", error: "start_rejected" })
    await f.execute(); await f.refresh(); expect(writes()).toHaveLength(1)
  }, 30_000)
  it("recovers accepted-but-unobserved identity after review expiry and policy change", async () => {
    const f = await fixture()
    google.respond({ method: "GET", pathIncludes: `${f.linked.googleLocationName}/verifications` }, () => ({ status: 200, json: { verifications: [] } }))
    const result = verificationAttemptResponseSchema.parse(await (await f.execute()).json()).attempt
    expect(result).toMatchObject({ status: "ambiguous", executionState: "accepted", confirmationState: "unresolved" })
    await admin`update gbp_change_set set approval_expires_at = now() - interval '1 minute' where id = ${f.review.changeSet.id}`
    await admin`update organisation set require_two_person_approval = true where id = ${f.owner.organisationId}`
    google.respond({ method: "GET", pathIncludes: `${f.linked.googleLocationName}/verifications` }, () => ({ status: 200, json: { verifications: [{ name: f.name, method: "EMAIL", state: "COMPLETED" }] } }))
    const response = await f.refresh(); expect(response.status, await response.clone().text()).toBe(200)
    expect(verificationAttemptResponseSchema.parse(await response.json()).attempt).toMatchObject({ id: result.id, status: "succeeded", executionState: "accepted", confirmationState: "confirmed", verification: { phase: "completed" }, merchant: { hasVoiceOfMerchant: false } })
    expect((await f.execute()).status).toBe(200); expect(writes()).toHaveLength(1)
  }, 30_000)
  it("keeps a lost start response unknown even if Google now reports a completed request and merchant standing", async () => {
    const f = await fixture(); let after = false
    google.respond({ method: "GET", pathIncludes: `${f.linked.googleLocationName}/verifications` }, () => ({ status: 200, json: { verifications: after ? [{ name: f.name, method: "EMAIL", state: "COMPLETED" }] : [] } }))
    google.respond({ method: "GET", pathEndsWith: `${f.linked.googleLocationName}/VoiceOfMerchantState` }, () => ({ status: 200, json: after ? { hasVoiceOfMerchant: true } : { hasVoiceOfMerchant: false, verify: { hasPendingVerification: false } } }))
    google.respond({ method: "POST", pathEndsWith: `${f.linked.googleLocationName}:verify` }, () => { after = true; return { status: 503, json: { error: { message: "private-ambiguous-echo" } } } })
    const first = verificationAttemptResponseSchema.parse(await (await f.execute()).json()).attempt
    expect(first).toMatchObject({ status: "ambiguous", executionState: "unknown", confirmationState: "unresolved", verification: null, merchant: { hasVoiceOfMerchant: true } })
    const restored = verificationAttemptResponseSchema.parse(await (await f.refresh()).json()).attempt
    expect(restored).toMatchObject({ id: first.id, status: "ambiguous", verification: null })
    await f.execute(); expect(writes()).toHaveLength(1)
  }, 30_000)
  it("serializes duplicate execution claims", async () => {
    const f = await fixture(); const responses = await Promise.all([f.execute(), f.execute()])
    expect(responses.some((response) => response.status === 200)).toBe(true)
    expect(responses.every((response) => response.status === 200 || response.status === 409)).toBe(true)
    expect(writes()).toHaveLength(1)
    expect(await admin`select id from gbp_management_mutation where change_set_id = ${f.review.changeSet.id}`).toHaveLength(1)
  }, 30_000)
  it("blocks early interrupted recovery and later observes without sending again", async () => {
    const f = await fixture(); const result = verificationAttemptResponseSchema.parse(await (await f.execute()).json()).attempt
    await admin`update gbp_management_mutation set status = 'started', execution_state = 'pending', confirmation_state = 'pending', google_response = null, created_at = now() where id = ${result.id}`
    expect((await f.refresh()).status).toBe(409)
    await admin`update gbp_management_mutation set created_at = now() - interval '6 minutes' where id = ${result.id}`
    const response = await f.refresh(); expect(response.status).toBe(200)
    expect(verificationAttemptResponseSchema.parse(await response.json()).attempt).toMatchObject({ id: result.id, status: "ambiguous", executionState: "unknown", confirmationState: "unresolved", verification: null })
    await f.execute(); expect(writes()).toHaveLength(1)
  }, 30_000)
  it("rejects unreviewed payload additions and cross-tenant status access", async () => {
    const f = await fixture()
    expect((await send(f.url, f.owner.cookie, { ...f.body, payload: { method: "AUTO" } })).status).toBe(400)
    await f.execute()
    const foreign = await createTestTenant(admin); organisations.push(foreign.organisationId)
    expect((await fetch(f.url, { headers: { cookie: foreign.cookie } })).status).toBe(404)
    expect(writes()).toHaveLength(1)
  }, 30_000)
  it.each(["foreign", "malformed", "method", "unknown_state"])("keeps %s provider identity unresolved without private echoes", async (kind) => {
    const f = await fixture()
    if (kind === "foreign" || kind === "malformed") google.respond({ method: "POST", pathEndsWith: `${f.linked.googleLocationName}:verify` }, () => ({ status: 200, json: { verification: { name: kind === "foreign" ? "locations/foreign/verifications/request" : f.name, method: "EMAIL", state: kind === "malformed" ? "private-unreadable-echo" : "PENDING" } } }))
    // Method/state divergence occurs only after sending, preserving the reviewed preflight baseline.
    if (kind === "method" || kind === "unknown_state") {
      let applied = false
      google.respond({ method: "GET", pathIncludes: `${f.linked.googleLocationName}/verifications` }, () => ({ status: 200, json: { verifications: applied ? [{ name: f.name, method: kind === "method" ? "SMS" : "EMAIL", state: kind === "unknown_state" ? "FUTURE_STATE" : "PENDING" }] : [] } }))
      google.respond({ method: "POST", pathEndsWith: `${f.linked.googleLocationName}:verify` }, () => { applied = true; return { status: 200, json: { verification: { name: f.name, method: "EMAIL", state: "PENDING" } } } })
    }
    const response = await f.execute(); expect(response.status, await response.clone().text()).toBe(200)
    expect(verificationAttemptResponseSchema.parse(await response.json()).attempt).toMatchObject({ status: "ambiguous", confirmationState: "unresolved", error: "outcome_unresolved" })
    const rows = await admin`select google_response from gbp_management_mutation where change_set_id = ${f.review.changeSet.id}`
    expect(JSON.stringify(rows)).not.toContain("private-unreadable-echo")
    expect(JSON.stringify(rows)).not.toContain("locations/foreign")
    await f.execute(); expect(writes()).toHaveLength(1)
  }, 30_000)
  it("keeps status and recovery available while writes are paused", async () => {
    const f = await fixture(); const result = verificationAttemptResponseSchema.parse(await (await f.execute()).json()).attempt
    const paused = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl, GBP_PROFILE_WRITES_ENABLED: "false", PUBLISH_ENABLED: "false" })
    try {
      const url = f.url.replace(server.baseUrl, paused.baseUrl)
      const read = await fetch(url, { headers: { cookie: f.owner.cookie } }); expect(read.status).toBe(200)
      expect(verificationAttemptResponseSchema.parse(await read.json()).attempt.id).toBe(result.id)
      const refreshed = await send(url, f.owner.cookie, {}, "PATCH"); expect(refreshed.status).toBe(200)
      expect(verificationAttemptResponseSchema.parse(await refreshed.json()).attempt.id).toBe(result.id)
      expect(writes()).toHaveLength(1)
    } finally { await paused.stop() }
  }, 30_000)
  it.each([false, true])("rechecks the separate approver before execution (revoked=%s)", async (revoked) => {
    const f = await fixture("EMAIL", true, true)
    if (revoked) await admin`update member set role = 'viewer' where user_id = ${f.approver.userId}`
    const response = await f.execute(); expect(response.status).toBe(revoked ? 409 : 200)
    expect(writes()).toHaveLength(revoked ? 0 : 1)
  }, 30_000)
  it("blocks a competing unresolved legacy verification attempt", async () => {
    const f = await fixture()
    await admin`insert into gbp_management_mutation (organisation_id, location_id, google_account_id, actor_user_id, resource_type, operation, target_resource_name, status, idempotency_key, execution_state, confirmation_state)
      select ${f.owner.organisationId}, ${f.linked.locationId}, id, ${f.owner.userId}, 'verification', 'start_verification', ${f.linked.googleLocationName}, 'ambiguous', 'legacy-unresolved', 'unknown', 'unresolved'
      from google_account where google_connection_id = ${f.connection.connectionId}`
    const response = await f.execute(); expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: "google_confirmation_unresolved" })
    expect(writes()).toHaveLength(0)
    expect(await admin`select id from gbp_management_mutation where change_set_id = ${f.review.changeSet.id}`).toHaveLength(0)
  }, 30_000)
  it.each(["pending", "standing", "unknown", "waiting"] as const)("requires Google-side resolution for %s state before starting", async (standing) => {
    const f = await fixture("EMAIL", true, false, standing)
    const response = await f.execute(); expect(response.status).toBe(409)
    expect(writes()).toHaveLength(0)
    expect(await admin`select id from gbp_management_mutation where change_set_id = ${f.review.changeSet.id}`).toHaveLength(0)
  }, 30_000)
  it("restores saved outcomes after disconnect and retains prior confirmation when refresh fails", async () => {
    const f = await fixture(); const original = verificationAttemptResponseSchema.parse(await (await f.execute()).json()).attempt
    await admin`update google_connection set status = 'disconnected' where id = ${f.connection.connectionId}`
    const read = await fetch(f.url, { headers: { cookie: f.owner.cookie } }); expect(read.status).toBe(200)
    expect(verificationAttemptResponseSchema.parse(await read.json()).attempt).toMatchObject({ id: original.id, confirmationState: "confirmed", verification: { phase: "pending" } })
    const callsBefore = google.calls.length
    const refresh = await f.refresh(); expect(refresh.status).toBe(200)
    expect(verificationAttemptResponseSchema.parse(await refresh.json()).attempt).toMatchObject({ id: original.id, status: "succeeded", confirmationState: "confirmed", error: "refresh_unavailable", observedAt: original.observedAt })
    expect(google.calls).toHaveLength(callsBefore); expect(writes()).toHaveLength(1)
  }, 30_000)
})
