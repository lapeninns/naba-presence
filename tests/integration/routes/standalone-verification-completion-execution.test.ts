import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { verificationAttemptResponseSchema } from "@/lib/contracts/google-verification-attempt"
import { verificationCompletionReviewResponseSchema } from "@/lib/contracts/google-verification-completion-review"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { createTestTenant, destroyTenants, seedGoogleConnection, seedLinkedReview, seedMemberUser } from "../helpers/tenant"

const suite = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
suite("standalone approved PIN completion single-send execution", () => {
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
  async function fixture(method = "EMAIL", approve = true, twoPerson = false) {
    const owner = await createTestTenant(admin); organisations.push(owner.organisationId)
    const approver = twoPerson ? await seedMemberUser(admin, { organisationId: owner.organisationId }) : owner
    if (twoPerson) {
      await admin`update member set role = 'admin', can_publish = true where user_id = ${approver.userId}`
      await admin`update organisation set require_two_person_approval = true where id = ${owner.organisationId}`
    }
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    const name = `${linked.googleLocationName}/verifications/exact-pending`, pin = "001234-secret-completion-pin"
    let phase = "PENDING"
    const verification = () => ({ name, method, state: phase, createTime: "2026-09-30T00:00:00Z" })
    google.reset()
    google.respond({ method: "GET", pathIncludes: `${linked.googleLocationName}/verifications` }, () => ({ status: 200, json: { verifications: [verification()] } }))
    google.respond({ method: "GET", pathEndsWith: `${linked.googleLocationName}/VoiceOfMerchantState` }, () => ({ status: 200, json: { hasVoiceOfMerchant: false, verify: { hasPendingVerification: phase === "PENDING" } } }))
    google.respond({ method: "POST", pathEndsWith: `${name}:complete` }, () => { phase = "COMPLETED"; return { status: 200, json: { verification: { ...verification(), pin, announcement: pin }, token: pin } } })
    const base = `${server.baseUrl}/api/locations/${linked.locationId}/verification-completion-reviews`
    async function preview(value = pin) {
      const response = await send(base, owner.cookie, { name, pin: value })
      expect(response.status, await response.clone().text()).toBe(200)
      const reviewed = verificationCompletionReviewResponseSchema.parse(await response.json()).review
      if (approve) {
        const approval = await send(`${base}/${reviewed.changeSet.id}`, approver.cookie, { expectedPayloadHash: reviewed.changeSet.payloadHash })
        expect(approval.status, await approval.clone().text()).toBe(200)
      }
      return reviewed
    }
    const review = await preview(), url = `${base}/${review.changeSet.id}/execute`
    const body = { expectedPayloadHash: review.changeSet.payloadHash, confirmation: "complete_google_location_verification", pin }
    return { owner, approver, connection, linked, name, pin, review, url, base, body, preview, verification,
      setPhase(value: string) { phase = value }, execute: () => send(url, owner.cookie, body), refresh: () => send(url, owner.cookie, {}, "PATCH") }
  }
  function writes() { return google.calls.filter((call) => call.path.endsWith(":complete")) }
  async function outcome(response: Response) {
    expect(response.status, await response.clone().text()).toBe(200)
    return verificationAttemptResponseSchema.parse(await response.json()).attempt
  }
  it.each(["EMAIL", "PHONE_CALL", "SMS", "ADDRESS"])("completes %s only after exact review and independent readback", async (method) => {
    // Given an approved pending request and transient PIN.
    const f = await fixture(method)
    // When it is executed once.
    const attempt = await outcome(await f.execute())
    // Then Google receives only the PIN, independent completion is recorded, and merchant standing remains separate.
    expect(attempt).toMatchObject({ operation: "complete_verification", status: "succeeded", executionState: "accepted", confirmationState: "confirmed", verification: { name: f.name, method, phase: "completed" }, merchant: { hasVoiceOfMerchant: false }, error: null })
    expect(writes()).toHaveLength(1); expect(writes()[0]?.body).toEqual({ pin: f.pin })
    const rows = await admin`select requested_payload, google_response, confirmation_response, finished_at from gbp_management_mutation where change_set_id = ${f.review.changeSet.id}`
    const audit = await admin`select metadata from audit_log where organisation_id = ${f.owner.organisationId}`
    expect(JSON.stringify({ attempt, rows, audit })).not.toContain(f.pin)
    expect(rows[0]?.finished_at).not.toBeNull()
  }, 30_000)
  it("returns the same attempt on replay without PIN validation or another provider request", async () => {
    const f = await fixture(); const first = await outcome(await f.execute()); const before = google.calls.length
    const replay = await outcome(await send(f.url, f.owner.cookie, { ...f.body, pin: "changed-after-send" }))
    expect(replay).toMatchObject({ id: first.id, idempotent: true, status: "succeeded" })
    expect(google.calls).toHaveLength(before); expect(writes()).toHaveLength(1)
  }, 30_000)
  it("claims one attempt under concurrent duplicate execution", async () => {
    const f = await fixture()
    const responses = await Promise.all([f.execute(), f.execute()])
    expect(responses.some((response) => response.status === 200)).toBe(true)
    expect(responses.every((response) => response.status === 200 || response.status === 409)).toBe(true)
    expect(writes()).toHaveLength(1)
    expect(await admin`select id from gbp_management_mutation where change_set_id = ${f.review.changeSet.id}`).toHaveLength(1)
  }, 30_000)
  it.each(["pin", "hash", "approval", "expiry", "policy", "generation", "phase", "approver", "cipher", "target"])("rejects %s drift without claiming an attempt or sending a PIN", async (kind) => {
    const f = await fixture("EMAIL", kind !== "approval", kind === "approver")
    if (kind === "expiry") await admin`update gbp_change_set set approval_expires_at = now() - interval '1 minute' where id = ${f.review.changeSet.id}`
    if (kind === "policy") await admin`update organisation set require_two_person_approval = true where id = ${f.owner.organisationId}`
    if (kind === "generation") await admin`update google_connection set credential_generation = credential_generation + 1 where id = ${f.connection.connectionId}`
    if (kind === "phase") f.setPhase("COMPLETED")
    if (kind === "approver") await admin`update member set role = 'viewer', can_publish = false where user_id = ${f.approver.userId}`
    if (kind === "cipher") await admin`update gbp_change_set set private_payload = ${Buffer.alloc(40)} where id = ${f.review.changeSet.id}`
    if (kind === "target") await admin`update external_location set google_location_name = 'locations/new-target' where id = ${f.linked.externalLocationId}`
    const response = await send(f.url, f.owner.cookie, { ...f.body, ...(kind === "pin" ? { pin: "different" } : {}), ...(kind === "hash" ? { expectedPayloadHash: "f".repeat(64) } : {}) })
    expect(response.status, await response.clone().text()).toBe(409)
    expect(writes()).toHaveLength(0)
    expect(await admin`select id from gbp_management_mutation where change_set_id = ${f.review.changeSet.id}`).toHaveLength(0)
  }, 30_000)
  it.each(["INVALID_ARGUMENT", "FAILED_PRECONDITION"])("records %s PIN rejection safely and never retries its review", async (code) => {
    const f = await fixture()
    google.respond({ method: "POST", pathEndsWith: `${f.name}:complete` }, () => ({ status: 400, json: { error: { status: code, message: f.pin, details: [{ pin: f.pin }] } } }))
    const rejected = await outcome(await f.execute())
    expect(rejected).toMatchObject({ status: "failed", executionState: "rejected", confirmationState: "unrecorded", error: "completion_rejected" })
    expect(await outcome(await f.refresh())).toMatchObject({ id: rejected.id, status: "failed", idempotent: true })
    expect(await outcome(await f.execute())).toMatchObject({ id: rejected.id, idempotent: true })
    expect(writes()).toHaveLength(1)
    const rows = await admin`select requested_payload, google_response, last_error_code from gbp_management_mutation where change_set_id = ${f.review.changeSet.id}`
    expect(JSON.stringify(rows)).not.toContain(f.pin)
  }, 30_000)
  it("requires a fresh reviewed PIN after a definitive rejection", async () => {
    const f = await fixture()
    google.respond({ method: "POST", pathEndsWith: `${f.name}:complete` }, () => ({ status: 400, json: { error: { status: "INVALID_ARGUMENT" } } }))
    await outcome(await f.execute())
    const pin = "009999-corrected-pin", review = await f.preview(pin)
    google.respond({ method: "POST", pathEndsWith: `${f.name}:complete` }, () => { f.setPhase("COMPLETED"); return { status: 200, json: { verification: f.verification() } } })
    const result = await outcome(await send(`${f.base}/${review.changeSet.id}/execute`, f.owner.cookie, { ...f.body, expectedPayloadHash: review.changeSet.payloadHash, pin }))
    expect(result).toMatchObject({ reviewId: review.changeSet.id, status: "succeeded" })
    expect(writes()).toHaveLength(2)
  }, 30_000)
  it("recovers a lost response through the exact reviewed resource without claiming acknowledgement", async () => {
    const f = await fixture()
    google.respond({ method: "POST", pathEndsWith: `${f.name}:complete` }, () => { f.setPhase("COMPLETED"); return { status: 503, json: { error: { status: "UNAVAILABLE", message: f.pin } } } })
    const result = await outcome(await f.execute())
    expect(result).toMatchObject({ status: "succeeded", executionState: "unknown", confirmationState: "confirmed", verification: { name: f.name, phase: "completed" } })
    expect(writes()).toHaveLength(1)
  }, 30_000)
  it.each(["foreign_response", "malformed_response"])("recovers %s against the reviewed target while retaining unknown execution", async (kind) => {
    const f = await fixture()
    google.respond({ method: "POST", pathEndsWith: `${f.name}:complete` }, () => { f.setPhase("COMPLETED"); return { status: 200, json: kind === "foreign_response" ? { verification: { ...f.verification(), name: "locations/foreign/verifications/other" } } : { verification: { state: "MALFORMED" } } } })
    const result = await outcome(await f.execute())
    expect(result).toMatchObject({ status: "succeeded", executionState: "unknown", confirmationState: "confirmed", verification: { name: f.name, phase: "completed" } })
    expect(writes()).toHaveLength(1)
  }, 30_000)
  it.each(["PENDING", "STATE_UNSPECIFIED", "FAILED"])("does not manufacture successful completion from independent %s", async (phase) => {
    const f = await fixture()
    google.respond({ method: "POST", pathEndsWith: `${f.name}:complete` }, () => { f.setPhase(phase); return { status: 200, json: { verification: { ...f.verification(), state: "COMPLETED" } } } })
    const result = await outcome(await f.execute())
    expect(result).toMatchObject(phase === "FAILED" ? { status: "failed", executionState: "accepted", confirmationState: "confirmed", error: "verification_failed" } : { status: "ambiguous", executionState: "accepted", confirmationState: "unresolved", error: "outcome_unresolved" })
    expect(result.verification?.phase).toBe(phase === "PENDING" ? "pending" : phase === "FAILED" ? "failed" : "unknown")
    expect(writes()).toHaveLength(1)
  }, 30_000)
  it("refreshes an accepted pending outcome to completion without resending", async () => {
    const f = await fixture()
    google.respond({ method: "POST", pathEndsWith: `${f.name}:complete` }, () => ({ status: 200, json: { verification: f.verification() } }))
    const first = await outcome(await f.execute()); expect(first.confirmationState).toBe("unresolved")
    f.setPhase("COMPLETED")
    expect(await outcome(await f.refresh())).toMatchObject({ id: first.id, status: "succeeded", executionState: "accepted", confirmationState: "confirmed" })
    expect(writes()).toHaveLength(1)
  }, 30_000)
  it("blocks a different completion review while the same exact target is unresolved", async () => {
    const f = await fixture(); const second = await f.preview()
    google.respond({ method: "POST", pathEndsWith: `${f.name}:complete` }, () => ({ status: 200, json: { verification: f.verification() } }))
    expect(await outcome(await f.execute())).toMatchObject({ confirmationState: "unresolved" })
    const blocked = await send(`${f.base}/${second.changeSet.id}/execute`, f.owner.cookie, { ...f.body, expectedPayloadHash: second.changeSet.payloadHash })
    expect(blocked.status).toBe(409); expect(writes()).toHaveLength(1)
  }, 30_000)
  it.each(["foreign_identity", "wrong_method"])("leaves %s readback unresolved despite a completed provider response", async (kind) => {
    const f = await fixture()
    let applied = false
    google.respond({ method: "GET", pathIncludes: `${f.linked.googleLocationName}/verifications` }, () => ({ status: 200, json: { verifications: [{ ...f.verification(), ...(applied ? kind === "foreign_identity" ? { name: `${f.linked.googleLocationName}/verifications/other`, state: "COMPLETED" } : { method: "SMS", state: "COMPLETED" } : {}) }] } }))
    google.respond({ method: "POST", pathEndsWith: `${f.name}:complete` }, () => { applied = true; return { status: 200, json: { verification: { ...f.verification(), state: "COMPLETED" } } } })
    const result = await outcome(await f.execute())
    expect(result).toMatchObject({ status: "ambiguous", executionState: "accepted", confirmationState: "unresolved", error: "outcome_unresolved" })
    expect(writes()).toHaveLength(1)
  }, 30_000)
  it("permits completing a known pending resource despite an unrelated lost start identity", async () => {
    const f = await fixture()
    await admin`insert into gbp_management_mutation (organisation_id, location_id, google_account_id, actor_user_id, resource_type, operation, target_resource_name, idempotency_key, status, execution_state, confirmation_state, requested_payload)
      values (${f.owner.organisationId}, ${f.linked.locationId}, (select id from google_account where google_connection_id = ${f.connection.connectionId}), ${f.owner.userId}, 'verification', 'start_verification', ${f.linked.googleLocationName}, 'lost-start', 'ambiguous', 'unknown', 'unresolved', '{}')`
    expect(await outcome(await f.execute())).toMatchObject({ status: "succeeded", confirmationState: "confirmed" })
    expect(writes()).toHaveLength(1)
  }, 30_000)
  it("blocks an unresolved legacy completion for the same exact verification", async () => {
    const f = await fixture()
    await admin`insert into gbp_management_mutation (organisation_id, location_id, google_account_id, actor_user_id, resource_type, operation, target_resource_name, idempotency_key, status, execution_state, confirmation_state, requested_payload)
      values (${f.owner.organisationId}, ${f.linked.locationId}, (select id from google_account where google_connection_id = ${f.connection.connectionId}), ${f.owner.userId}, 'verification', 'complete_verification', ${f.name}, 'lost-completion', 'ambiguous', 'unknown', 'unresolved', '{}')`
    const response = await f.execute()
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: "google_confirmation_unresolved" })
    expect(writes()).toHaveLength(0)
  }, 30_000)
  it("recovers an interrupted old attempt without the PIN, after expiry and policy change", async () => {
    const f = await fixture()
    await admin`insert into gbp_management_mutation (organisation_id, location_id, google_account_id, actor_user_id, resource_type, operation, target_resource_name, idempotency_key, status, execution_state, confirmation_state, requested_payload, change_set_id, created_at)
      values (${f.owner.organisationId}, ${f.linked.locationId}, (select id from google_account where google_connection_id = ${f.connection.connectionId}), ${f.owner.userId}, 'verification', 'complete_verification', ${f.name}, 'interrupted-completion', 'started', 'pending', 'pending', ${admin.json({ ...f.review.payload, connectionId: f.connection.connectionId, credentialGeneration: 0 })}, ${f.review.changeSet.id}, now() - interval '6 minutes')`
    await admin`update gbp_change_set set approval_expires_at = now() - interval '1 minute' where id = ${f.review.changeSet.id}`
    await admin`update organisation set require_two_person_approval = true where id = ${f.owner.organisationId}`
    f.setPhase("COMPLETED")
    expect(await outcome(await f.refresh())).toMatchObject({ status: "succeeded", executionState: "unknown", confirmationState: "confirmed" })
    expect(writes()).toHaveLength(0)
  }, 30_000)
  it("refuses recovery of a recent interrupted claim before the five-minute window", async () => {
    const f = await fixture()
    await admin`insert into gbp_management_mutation (organisation_id, location_id, google_account_id, actor_user_id, resource_type, operation, target_resource_name, idempotency_key, status, execution_state, confirmation_state, requested_payload, change_set_id)
      values (${f.owner.organisationId}, ${f.linked.locationId}, (select id from google_account where google_connection_id = ${f.connection.connectionId}), ${f.owner.userId}, 'verification', 'complete_verification', ${f.name}, 'recent-completion', 'started', 'pending', 'pending', ${admin.json({ ...f.review.payload, connectionId: f.connection.connectionId, credentialGeneration: 0 })}, ${f.review.changeSet.id})`
    expect((await f.refresh()).status).toBe(409)
    expect(writes()).toHaveLength(0)
  }, 30_000)
  it("blocks new execution while writes are paused but keeps existing read-only recovery available", async () => {
    const f = await fixture()
    const paused = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl, GBP_PROFILE_WRITES_ENABLED: "false", PUBLISH_ENABLED: "false" })
    const url = f.url.replace(server.baseUrl, paused.baseUrl)
    try {
      expect((await send(url, f.owner.cookie, f.body)).status).toBe(503)
      expect(writes()).toHaveLength(0)
      const first = await outcome(await f.execute())
      expect(await outcome(await send(url, f.owner.cookie, {}, "PATCH"))).toMatchObject({ id: first.id, confirmationState: "confirmed" })
      expect(writes()).toHaveLength(1)
    } finally { await paused.stop() }
  }, 30_000)
  it("retains prior confirmed phase and time if a later refresh fails", async () => {
    const f = await fixture(); const first = await outcome(await f.execute())
    google.respond({ method: "GET", pathIncludes: `${f.linked.googleLocationName}/verifications` }, () => ({ status: 403, json: { error: { status: "PERMISSION_DENIED" } } }))
    const result = await outcome(await f.refresh())
    expect(result).toMatchObject({ status: "succeeded", confirmationState: "confirmed", verification: { phase: "completed" }, observedAt: first.observedAt, error: "refresh_unavailable" })
    expect(writes()).toHaveLength(1)
  }, 30_000)
  it("keeps saved status accessible after disconnect and blocks a changed linked target", async () => {
    const f = await fixture(); const first = await outcome(await f.execute())
    await admin`update google_connection set status = 'revoked' where id = ${f.connection.connectionId}`
    expect(await outcome(await fetch(f.url, { headers: { cookie: f.owner.cookie } }))).toMatchObject({ id: first.id, confirmationState: "confirmed" })
    await admin`update external_location set google_location_name = 'locations/new-target' where id = ${f.linked.externalLocationId}`
    expect((await fetch(f.url, { headers: { cookie: f.owner.cookie } })).status).toBe(409)
  }, 30_000)
  it("rejects extra unreviewed inputs, foreign tenants and viewers", async () => {
    const f = await fixture()
    expect((await send(f.url, f.owner.cookie, { ...f.body, name: f.name })).status).toBe(400)
    const foreign = await createTestTenant(admin); organisations.push(foreign.organisationId)
    expect((await send(f.url, foreign.cookie, f.body)).status).toBe(404)
    const viewer = await seedMemberUser(admin, { organisationId: f.owner.organisationId, role: "viewer" })
    expect((await send(f.url, viewer.cookie, f.body)).status).toBe(403)
    expect(writes()).toHaveLength(0)
  }, 30_000)
})
