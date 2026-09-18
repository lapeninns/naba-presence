import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { listingSummarySchema } from "@/lib/contracts/location-summary"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
  seedMemberUser,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("listing summary routes", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    server = await startAppServer()
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("answers the wire contract for a linked listing without reading Google", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const location = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })

    const response = await fetch(
      `${server.baseUrl}/api/locations/${location.locationId}/summary`,
      { headers: { cookie: tenant.cookie } }
    )
    expect(response.status).toBe(200)
    const { summary } = (await response.json()) as { summary: unknown }
    const parsed = listingSummarySchema.parse(summary)
    expect(parsed.locationId).toBe(location.locationId)
    expect(parsed.linked).toBe(true)
    expect(parsed.connection?.status).toBe("active")
    // Nothing has been observed yet, so nothing claims to be in sync.
    expect(parsed.profile.status).toBe("unknown")
    expect(parsed.hours.status).toBe("unknown")
    expect(parsed.lastPublish).toBeNull()

    const board = await fetch(`${server.baseUrl}/api/listings/summary`, {
      headers: { cookie: tenant.cookie },
    })
    expect(board.status).toBe(200)
    const { summaries } = (await board.json()) as { summaries: unknown[] }
    expect(
      summaries.map((row) => listingSummarySchema.parse(row).locationId)
    ).toContain(location.locationId)
  })

  it("hides a listing the member cannot see", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const location = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    // A member assigned elsewhere: visibility narrows to their grants.
    const other = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const member = await seedMemberUser(admin, {
      organisationId: tenant.organisationId,
      role: "member",
      canPublish: false,
      assignLocationId: other.locationId,
    })

    const hidden = await fetch(
      `${server.baseUrl}/api/locations/${location.locationId}/summary`,
      { headers: { cookie: member.cookie } }
    )
    expect(hidden.status).toBe(404)

    const board = await fetch(`${server.baseUrl}/api/listings/summary`, {
      headers: { cookie: member.cookie },
    })
    const { summaries } = (await board.json()) as {
      summaries: { locationId: string }[]
    }
    expect(summaries.map((row) => row.locationId)).toEqual([other.locationId])
  })
})
