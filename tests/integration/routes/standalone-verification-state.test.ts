import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { verificationStateResponseSchema } from "@/lib/contracts/google-verification-state"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { createTestTenant, destroyTenants, seedGoogleConnection, seedLinkedReview, seedMemberUser } from "../helpers/tenant"

const suite = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
suite("standalone independent verification state", () => {
  let admin: ReturnType<typeof postgres>, google: GoogleStub, server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  beforeAll(async () => {
    const url = process.env.DIRECT_DATABASE_URL
    if (!url) throw new Error("Disposable database required")
    admin = postgres(url, { max: 1 }); google = await startGoogleStub()
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl, GBP_PROFILE_WRITES_ENABLED: "false", PUBLISH_ENABLED: "false" })
  })
  afterAll(async () => { await server.stop(); await google.stop(); await destroyTenants(admin, organisations); await admin.end() })
  async function fixture(role: "owner" | "admin" | "viewer" | "member" = "owner") {
    const owner = await createTestTenant(admin, { role, canPublish: false }); organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    google.reset()
    google.respond({ method: "GET", pathIncludes: `${linked.googleLocationName}/verifications` }, () => ({ status: 200, json: { verifications: [] } }))
    google.respond({ method: "GET", pathEndsWith: `${linked.googleLocationName}/VoiceOfMerchantState` }, () => ({ status: 200, json: { hasVoiceOfMerchant: false, hasBusinessAuthority: true, verify: { hasPendingVerification: true } } }))
    const url = `${server.baseUrl}/api/locations/${linked.locationId}/verification-state`
    return { owner, linked, connection, url, read: () => fetch(url, { headers: { cookie: owner.cookie } }) }
  }
  it.each(["owner", "admin"] as const)("allows %s read-only refresh while publishing is paused", async (role) => {
    const f = await fixture(role); const response = await f.read()
    expect(response.status).toBe(200)
    expect(verificationStateResponseSchema.parse(await response.json())).toMatchObject({ locationId: f.linked.locationId, googleLocationName: f.linked.googleLocationName, verifications: [], merchant: { hasVoiceOfMerchant: false, hasBusinessAuthority: true, action: "verify", hasPendingVerification: true }, merchantError: null })
    expect(google.calls.every((call) => call.method === "GET")).toBe(true)
  })
  it("reads all pages and keeps completed verification distinct from pending merchant review", async () => {
    const f = await fixture(); const name = f.linked.googleLocationName
    google.respond({ method: "GET", pathIncludes: `${name}/verifications` }, (call) => ({ status: 200, json: new URL(call.path, google.baseUrl).searchParams.has("pageToken")
      ? { verifications: [{ name: `${name}/verifications/older`, method: "SMS", state: "FAILED" }] }
      : { verifications: [{ name: `${name}/verifications/new`, method: "EMAIL", state: "COMPLETED", pin: "private-echo", token: "private-echo", createTime: "2026-09-30T01:00:00+01:00" }], nextPageToken: "next +/?" } }))
    google.respond({ method: "GET", pathEndsWith: `${name}/VoiceOfMerchantState` }, () => ({ status: 200, json: { hasVoiceOfMerchant: false, hasBusinessAuthority: true, waitForVoiceOfMerchant: {}, context: "private-echo" } }))
    const response = await f.read(); expect(response.status).toBe(200)
    const result = verificationStateResponseSchema.parse(await response.json())
    expect(result.verifications.map((item) => item.phase)).toEqual(["completed", "failed"])
    expect(result.merchant).toMatchObject({ action: "wait", hasVoiceOfMerchant: false })
    expect(new URL(google.calls[1]?.path ?? "", google.baseUrl).searchParams.get("pageToken")).toBe("next +/?")
    expect(JSON.stringify(result)).not.toContain("private-echo")
    expect(await admin`select id from gbp_management_mutation where organisation_id = ${f.owner.organisationId}`).toHaveLength(0)
    expect(await admin`select id from gbp_resource_snapshot where organisation_id = ${f.owner.organisationId}`).toHaveLength(0)
  })
  it.each(["loop", "duplicate", "foreign", "malformed", "limit"])("rejects %s history without presenting a partial result", async (kind) => {
    const f = await fixture(); const name = f.linked.googleLocationName
    google.respond({ method: "GET", pathIncludes: `${name}/verifications` }, (call) => {
      const current = new URL(call.path, google.baseUrl).searchParams.get("pageToken")
      const json = kind === "loop" ? { nextPageToken: "repeat" }
        : kind === "duplicate" ? { verifications: [{ name: `${name}/verifications/same` }], ...(current ? {} : { nextPageToken: "second" }) }
        : kind === "foreign" ? { verifications: [{ name: "locations/foreign/verifications/one" }] }
        : kind === "malformed" ? { verifications: [{ state: "PENDING" }] }
        : { nextPageToken: String(Number(current ?? 0) + 1) }
      return { status: 200, json }
    })
    const response = await f.read(); expect(response.status).toBe(502)
    expect(await response.json()).not.toHaveProperty("verifications")
    expect(google.calls).toHaveLength(kind === "limit" ? 20 : kind === "loop" || kind === "duplicate" ? 2 : 1)
  }, 30_000)
  it.each(["failed", "malformed", "conflicting"])("preserves readable history while merchant state is %s", async (kind) => {
    const f = await fixture()
    google.respond({ method: "GET", pathEndsWith: `${f.linked.googleLocationName}/VoiceOfMerchantState` }, () => kind === "failed"
      ? { status: 403, json: { error: { message: "private-echo" } } }
      : { status: 200, json: kind === "malformed" ? { hasVoiceOfMerchant: "yes" } : { verify: {}, waitForVoiceOfMerchant: {} } })
    const response = await f.read(); expect(response.status).toBe(200)
    expect(verificationStateResponseSchema.parse(await response.json())).toMatchObject({ verifications: [], merchant: null, merchantError: "verification_merchant_state_unavailable" })
    expect(server.stdout + server.stderr).not.toContain("private-echo")
  })
  it("redacts provider history errors", async () => {
    const f = await fixture()
    google.respond({ method: "GET", pathIncludes: `${f.linked.googleLocationName}/verifications` }, () => ({ status: 403, json: { error: { message: "private-echo", status: "PERMISSION_DENIED" } } }))
    const response = await f.read(); expect(response.status).toBe(403)
    expect(await response.text()).not.toContain("private-echo")
  })
  it.each(["target", "connection", "membership", "role", "account", "generation"])("rechecks %s after provider observation", async (kind) => {
    const f = await fixture()
    if (kind === "membership" || kind === "role") {
      const retainedOwner = await seedMemberUser(admin, { organisationId: f.owner.organisationId })
      await admin`update member set role = 'owner' where user_id = ${retainedOwner.userId}`
    }
    google.respond({ method: "GET", pathEndsWith: `${f.linked.googleLocationName}/VoiceOfMerchantState` }, async () => {
      if (kind === "target") await admin`update external_location set google_location_name = 'locations/changed' where id = ${f.linked.externalLocationId}`
      if (kind === "connection") await admin`update google_connection set status = 'revoked' where id = ${f.connection.connectionId}`
      if (kind === "membership") await admin`delete from member where organisation_id = ${f.owner.organisationId} and user_id = ${f.owner.userId}`
      if (kind === "role") await admin`update member set role = 'viewer' where organisation_id = ${f.owner.organisationId} and user_id = ${f.owner.userId}`
      if (kind === "account") await admin`update google_account set is_active = false where google_connection_id = ${f.connection.connectionId}`
      if (kind === "generation") await admin`update google_connection set credential_generation = credential_generation + 1 where id = ${f.connection.connectionId}`
      return { status: 200, json: { hasVoiceOfMerchant: true } }
    })
    const response = await f.read(); expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await response.json()).not.toHaveProperty("verifications")
  })
  it.each(["viewer", "member"] as const)("rejects %s before provider access", async (role) => {
    const f = await fixture(role); expect((await f.read()).status).toBe(403); expect(google.calls).toHaveLength(0)
  })
  it("does not reveal another tenant's location", async () => {
    const f = await fixture(); const foreign = await createTestTenant(admin); organisations.push(foreign.organisationId)
    expect((await fetch(f.url, { headers: { cookie: foreign.cookie } })).status).toBe(404)
    expect(google.calls).toHaveLength(0)
  })
})
