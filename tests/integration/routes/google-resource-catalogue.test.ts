import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { locationCapabilitiesResponseSchema } from "@/lib/contracts/location-capabilities"
import { startAppServer } from "../helpers/app-server"
import { createTestTenant, destroyTenants, seedGoogleConnection, seedLinkedLocation, seedMemberUser } from "../helpers/tenant"

const describeDatabase = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip

describeDatabase("resource/action catalogue through the standalone capability route", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    server = await startAppServer({ PUBLISH_ENABLED: "true", GBP_PROFILE_WRITES_ENABLED: "true", GBP_POSTS_ENABLED: "true" })
  })
  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function fixture() {
    const owner = await createTestTenant(admin, { role: "owner" })
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const location = await seedLinkedLocation(admin, { organisationId: owner.organisationId, connectionId: connection.connectionId, googleAccountName: connection.googleAccountName })
    return { owner, connection, location }
  }
  async function capabilities(cookie: string, locationId: string) {
    const response = await fetch(`${server.baseUrl}/api/locations/${locationId}/capabilities`, { headers: { cookie } })
    expect(response.status).toBe(200)
    return locationCapabilitiesResponseSchema.parse(await response.json()).capabilities
  }

  it("returns current documented actions without promoting local publishing rights to Google eligibility", async () => {
    const { owner, location } = await fixture()
    const result = await capabilities(owner.cookie, location.locationId)
    expect(result).toMatchObject({ canEditCanonical: true, canPublish: true })
    expect(result.resourceActions?.actions["posts.create"]).toMatchObject({ support: "supported", eligibility: "unknown", canWrite: false, reasonCode: "eligibility_unknown", observedAt: null })
    expect(result.resourceActions?.actions["accountAdmins.list"]).toMatchObject({ canRead: true, eligibility: "unknown" })
  })

  it("uses current role and connection state for action availability while retaining the existing surface map", async () => {
    const { owner, connection, location } = await fixture()
    const viewer = await seedMemberUser(admin, { organisationId: owner.organisationId, role: "viewer", canPublish: false })
    const viewerResult = await capabilities(viewer.cookie, location.locationId)
    expect(viewerResult.resourceActions?.actions["accountAdmins.list"]).toMatchObject({ canRead: false, reasonCode: "permission_denied" })
    expect(viewerResult.resourceActions?.actions["posts.list"]).toMatchObject({ canRead: true, canWrite: false })
    await admin`update google_connection set status = 'disconnected' where id = ${connection.connectionId}`
    const disconnected = await capabilities(owner.cookie, location.locationId)
    expect(disconnected.resources?.posts).toMatchObject({ state: "available" })
    expect(disconnected.resourceActions?.actions["posts.list"]).toMatchObject({ canRead: false, reasonCode: "reconnect_required" })
    expect(disconnected.resourceActions?.actions["posts.create"]).toMatchObject({ canWrite: false, reasonCode: "reconnect_required" })
    expect(disconnected.resourceActions?.actions["retailProducts.manage"]).toMatchObject({ support: "external", reasonCode: "managed_in_google" })
  })
})
