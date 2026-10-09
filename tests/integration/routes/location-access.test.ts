import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

/**
 * Business-mode "Location access": the same location_member rows, written a
 * location at a time through PUT /api/members/[userId]/client-access.
 * Written with the business-mode shell stage; run it with the other
 * integration suites (RUN_DB_TESTS=true).
 */
describeDatabase("location access in a business", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    server = await startAppServer()
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function fixture() {
    const owner = await createTestTenant(admin, { workspaceMode: "business" })
    organisations.push(owner.organisationId)
    const [home] = await admin<{ id: string }[]>`
      select id::text as id from client
      where organisation_id = ${owner.organisationId} and is_home
    `
    const locations: string[] = []
    for (const name of ["The Barley Mow", "The Bell", "The Queen Elizabeth"]) {
      const id = randomUUID()
      await admin`
        insert into location (id, organisation_id, name, client_id)
        values (${id}, ${owner.organisationId}, ${name}, ${home.id})
      `
      locations.push(id)
    }
    const memberId = randomUUID()
    await admin`
      insert into app_user (id, email, display_name, default_organisation_id)
      values (
        ${memberId},
        ${`harness-member-${memberId.slice(0, 8)}@nabapresence.test`},
        'Harness member',
        ${owner.organisationId}
      )
    `
    await admin`
      insert into member (organisation_id, user_id, role, can_publish)
      values (${owner.organisationId}, ${memberId}, 'member', false)
    `
    return { owner, locations, memberId }
  }

  const call = (
    server: { baseUrl: string },
    cookie: string,
    memberId: string,
    method: "GET" | "PUT",
    body?: unknown
  ) =>
    fetch(`${server.baseUrl}/api/members/${memberId}/client-access`, {
      method,
      headers: { cookie, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  it("grants the ticked locations and reports them back", async () => {
    const { owner, locations, memberId } = await fixture()
    const put = await call(server, owner.cookie, memberId, "PUT", {
      locations: [
        { locationId: locations[0], canPublish: true },
        { locationId: locations[1] },
      ],
    })
    expect(put.status, await put.clone().text()).toBe(200)
    const body = (await put.json()) as {
      allClients: boolean
      locationGrants: { locationId: string; canPublish: boolean }[]
    }
    expect(body.allClients).toBe(false)
    expect(
      body.locationGrants.sort((a, b) =>
        a.locationId.localeCompare(b.locationId)
      )
    ).toEqual(
      [
        { locationId: locations[0], canPublish: true },
        { locationId: locations[1], canPublish: false },
      ].sort((a, b) => a.locationId.localeCompare(b.locationId))
    )

    const rows = await admin<{ locationId: string }[]>`
      select location_id::text as "locationId" from location_member
      where user_id = ${memberId}
    `
    expect(rows.map((row) => row.locationId).sort()).toEqual(
      [locations[0], locations[1]].sort()
    )
  })

  it("refuses an empty selection rather than widening to every location", async () => {
    const { owner, memberId } = await fixture()
    const put = await call(server, owner.cookie, memberId, "PUT", {
      locations: [],
    })
    expect(put.status).toBe(409)
    expect(await put.json()).toMatchObject({
      error: "would_widen_to_all_clients",
    })
  })

  it("refuses a location from another organisation", async () => {
    const { owner, memberId } = await fixture()
    const stranger = await fixture()
    const put = await call(server, owner.cookie, memberId, "PUT", {
      locations: [{ locationId: stranger.locations[0] }],
    })
    expect(put.status).toBe(404)
  })

  it("returns to every location with allClients", async () => {
    const { owner, locations, memberId } = await fixture()
    await call(server, owner.cookie, memberId, "PUT", {
      locations: [{ locationId: locations[0] }],
    })
    const put = await call(server, owner.cookie, memberId, "PUT", {
      allClients: true,
    })
    expect(put.status).toBe(200)
    const body = (await put.json()) as {
      allClients: boolean
      locationGrants: unknown[]
    }
    expect(body.allClients).toBe(true)
    expect(body.locationGrants).toEqual([])
  })
})
