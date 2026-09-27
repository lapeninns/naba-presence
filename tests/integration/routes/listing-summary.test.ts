import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { listingSummarySchema } from "@/lib/contracts/location-summary"

import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
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
  it("rolls actual canonical checks into clients and preserves failed profile/menu evidence", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const [client] = await admin<
      { id: string }[]
    >`insert into client (organisation_id, name, slug) values (${owner.organisationId}, 'Comparison fixture', 'comparison-fixture') returning id::text as id`
    await admin`update location set client_id = ${client.id} where id = ${linked.locationId}`
    let failRead = false
    google.respond(
      { method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` },
      () =>
        failRead
          ? {
              status: 400,
              json: { error: { message: "Synthetic area read failure" } },
            }
          : {
              status: 200,
              json: {
                name: linked.googleLocationName,
                title: "Comparison pub",
                metadata: { canHaveFoodMenus: false },
                regularHours: { periods: [] },
                specialHours: { specialHourPeriods: [] },
                moreHours: [],
              },
            }
    )
    const root = `${server.baseUrl}/api/locations/${linked.locationId}`
    async function read(path: string) {
      const response = await fetch(path, { headers: { cookie: owner.cookie } })
      expect(response.status, await response.clone().text()).toBe(200)
      return response.json()
    }
    const clientState = async () =>
      (await read(`${server.baseUrl}/api/clients`)).items.find(
        (item: { id: string }) => item.id === client.id
      )
    expect((await clientState()).health).toBe("unchecked")
    await read(`${root}/hours`)
    expect((await clientState()).health).toBe("partially_checked")
    await read(`${root}/profile`)
    await read(`${root}/food-menus`)
    const complete = (await read(`${root}/summary`)).summary
    expect(complete.menu.eligible).toBe(false)
    expect(await clientState()).toMatchObject({
      health: "healthy",
      canonicalChecks: { total: 1, checked: 1 },
    })
    for (const [endpoint, area] of [
      ["profile", "profile"],
      ["food-menus", "menu"],
    ]) {
      failRead = true
      const failed = await fetch(`${root}/${endpoint}`, {
        headers: { cookie: owner.cookie },
      })
      expect(failed.status).toBeGreaterThanOrEqual(400)
      const summary = (await read(`${root}/summary`)).summary
      expect(summary[area]).toMatchObject({
        checkStatus: "failed",
        observedAt: complete[area].observedAt,
      })
      if (area === "menu") expect(summary.menu.eligible).toBeNull()
      expect((await clientState()).health).toBe("attention")
      failRead = false
      await read(`${root}/${endpoint}`)
      expect((await clientState()).health).toBe("healthy")
    }
    await admin`update presence_resource_reconcile_state set status = 'failed', last_error_code = 'proposal_raise_failed', last_attempt_at = now(), reconciliation_started_at = now() where location_id = ${linked.locationId} and resource = 'profile'`
    expect((await clientState()).health).toBe("healthy")
    await admin`update presence_resource_reconcile_state set last_error_code = 'stored_state_read_failed' where location_id = ${linked.locationId} and resource = 'profile'`
    expect((await clientState()).health).toBe("attention")
    await read(`${root}/profile`)
    expect((await clientState()).health).toBe("healthy")
    await admin`update presence_resource_reconcile_state set status = 'failed', last_error_code = 'older_scheduler_failure', last_attempt_at = now(), reconciliation_started_at = observation_attempted_at - interval '1 second' where location_id = ${linked.locationId} and resource = 'profile'`
    expect((await clientState()).health).toBe("healthy")
    for (const [endpoint, resource] of [
      ["profile", "profile"],
      ["hours", "hours"],
      ["food-menus", "foodMenus"],
    ]) {
      let started = false
      google.respond(
        { method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` },
        () => {
          started = true
          return {
            status: 200,
            delayMs: 1200,
            json: {
              name: linked.googleLocationName,
              title: "Comparison pub",
              metadata: { canHaveFoodMenus: false },
              regularHours: { periods: [] },
              specialHours: { specialHourPeriods: [] },
              moreHours: [],
            },
          }
        }
      )
      const older = fetch(`${root}/${endpoint}`, {
        headers: { cookie: owner.cookie },
      })
      await vi.waitFor(() => expect(started).toBe(true))
      await admin`update presence_resource_reconcile_state set status = 'failed', last_error_code = 'newer_scheduler_failure', last_attempt_at = now(), reconciliation_started_at = now() where location_id = ${linked.locationId} and resource = ${resource}`
      expect((await older).status).toBe(200)
      const [persisted] =
        await admin`select status, last_error_code from presence_resource_reconcile_state where location_id = ${linked.locationId} and resource = ${resource}`
      expect(persisted).toMatchObject({
        status: "failed",
        last_error_code: "newer_scheduler_failure",
      })
      expect((await clientState()).health).toBe("attention")
      await read(`${root}/${endpoint}`)
      expect((await clientState()).health).toBe("healthy")
    }
    const outsider = await createTestTenant(admin)
    organisations.push(outsider.organisationId)
    const foreign = await fetch(`${server.baseUrl}/api/clients`, {
      headers: { cookie: outsider.cookie },
    })
    expect((await foreign.json()).items).toEqual([])
  }, 30_000)
})
