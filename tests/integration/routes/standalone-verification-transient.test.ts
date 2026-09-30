import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { createTestTenant, destroyTenants, seedGoogleConnection, seedLinkedReview } from "../helpers/tenant"

const describeDatabase = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip

describeDatabase("retired unreviewed verification compatibility", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  beforeAll(async () => {
    const databaseUrl = process.env.DIRECT_DATABASE_URL
    if (!databaseUrl) throw new Error("DIRECT_DATABASE_URL is required")
    admin = postgres(databaseUrl, { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl, GBP_PROFILE_WRITES_ENABLED: "true", PUBLISH_ENABLED: "true" })
  })
  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })
  async function fixture() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    google.reset()
    return { owner, url: `${server.baseUrl}/api/locations/${linked.locationId}/administration` }
  }
  it.each([
    ["start_verification", { method: "EMAIL", emailAddress: "owner@example.test" }],
    ["start_verification", { method: "VETTED_PARTNER", token: { tokenString: "fixture-private-credential" }, unknown: { echo: "fixture-private-credential" } }],
    ["complete_verification", { name: "locations/foreign/verifications/pending", pin: "fixture-private-credential" }],
    ["complete_verification", { name: "locations/foreign/verifications/../pending", pin: "fixture-private-credential" }],
    ["complete_verification", {}],
  ] as const)("rejects legacy %s before side effects", async (operation, payload) => {
    const { owner, url } = await fixture()
    const response = await fetch(url, { method: "PATCH", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ operation, confirmation: operation === "start_verification" ? "start_google_location_verification" : "complete_google_location_verification", payload }) })
    expect(response.status).toBe(409)
    const body = await response.text()
    expect(body).toContain("verification_review_required")
    expect(body).not.toContain("fixture-private-credential")
    expect(google.calls).toHaveLength(0)
    expect(await admin`select id from gbp_management_mutation where organisation_id = ${owner.organisationId}`).toHaveLength(0)
    expect(await admin`select id from audit_log where organisation_id = ${owner.organisationId} and action in ('google.start_verification', 'google.complete_verification')`).toHaveLength(0)
    expect(server.stdout + server.stderr).not.toContain("fixture-private-credential")
  })
  it("keeps access compatibility fields without requesting or caching verification", async () => {
    const { owner, url } = await fixture()
    const response = await fetch(url, { headers: { cookie: owner.cookie } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ administration: { voice: { data: null, error: "verification_workflow_moved" }, verifications: { data: null, error: "verification_workflow_moved" }, verificationOptions: { data: null, error: "verification_workflow_moved" } } })
    expect(google.calls.filter((call) => /VoiceOfMerchantState|verifications|fetchVerificationOptions/.test(call.path))).toHaveLength(0)
    expect(await admin`select id from gbp_resource_snapshot where organisation_id = ${owner.organisationId} and resource_type = 'verification'`).toHaveLength(0)
  })
})
