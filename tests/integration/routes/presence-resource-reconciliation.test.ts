import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

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

describeDatabase("Presence resource background reconciliation", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl })
  })

  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("authenticates cron, isolates failures, and records all resource attempts", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const endpoint = `${server.baseUrl}/api/sync/presence-resources`
    const unauthorised = await fetch(endpoint, { method: "POST", body: "{}", headers: { "content-type": "application/json" } })
    expect(unauthorised.status).toBe(401)

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: "Bearer route-harness-cron-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ maxOrganisations: 25, maxLocations: 5 }),
    })
    expect(response.status, `${await response.clone().text()}\n${server.stderr}`).toBe(200)
    const payload = await response.json()
    const outcomes = payload.outcomes.filter(
      (outcome: { organisationId: string; locationId: string }) =>
        outcome.organisationId === owner.organisationId && outcome.locationId === linked.locationId
    )
    expect(outcomes).toHaveLength(6)
    expect(outcomes.map((outcome: { resource: string }) => outcome.resource).sort()).toEqual(
      ["foodMenus", "hours", "media", "placeActions", "posts", "profile"]
    )
    expect(outcomes.some((outcome: { status: string }) => outcome.status === "failed")).toBe(true)

    const states = await admin<{ resource: string; status: string }[]>`
      select resource, status from presence_resource_reconcile_state
      where organisation_id = ${owner.organisationId} and location_id = ${linked.locationId}
      order by resource`
    expect(states).toHaveLength(6)
  }, 30_000)
})
