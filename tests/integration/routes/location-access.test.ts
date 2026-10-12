import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedMemberUser,
  seedReview,
} from "../helpers/tenant"

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

  it("saves an empty selection as no access rather than widening to every location", async () => {
    const { owner, locations, memberId } = await fixture()
    await call(server, owner.cookie, memberId, "PUT", {
      locations: [{ locationId: locations[0] }],
    })
    const put = await call(server, owner.cookie, memberId, "PUT", {
      locations: [],
    })
    expect(put.status, await put.clone().text()).toBe(200)
    expect(await put.json()).toMatchObject({
      allClients: false,
      noAccess: true,
      locationGrants: [],
    })
    const [member] = await admin<{ locationScope: string }[]>`
      select location_scope as "locationScope" from member
      where user_id = ${memberId}
    `
    expect(member.locationScope).toBe("assigned")
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

/**
 * The reader switch (P02-S4): an assigned member whose last listing goes
 * sees nothing, never every location.
 */
describeDatabase("explicit scope: removing the last assignment", () => {
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

  const status = async (cookie: string, reviewId: string) =>
    (
      await fetch(`${server.baseUrl}/api/reviews/${reviewId}`, {
        headers: { cookie },
      })
    ).status

  async function fixture(role: "member" | "viewer") {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const assigned = await seedReview(admin, {
      organisationId: owner.organisationId,
    })
    const other = await seedReview(admin, {
      organisationId: owner.organisationId,
    })
    const member = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      role,
      assignLocationId: assigned.locationId,
    })
    return { owner, assigned, other, member }
  }

  it.each(["member", "viewer"] as const)(
    "a %s whose final location_member row is deleted sees nothing",
    async (role) => {
      const { assigned, other, member } = await fixture(role)
      expect(await status(member.cookie, assigned.reviewId)).toBe(200)
      expect(await status(member.cookie, other.reviewId)).toBe(404)

      // What a listing deletion's cascade does to the rows.
      await admin`delete from location_member where user_id = ${member.userId}`

      expect(await status(member.cookie, assigned.reviewId)).toBe(404)
      expect(await status(member.cookie, other.reviewId)).toBe(404)
      const [row] = await admin<{ locationScope: string }[]>`
        select location_scope as "locationScope" from member
        where user_id = ${member.userId}
      `
      expect(row.locationScope).toBe("assigned")
    }
  )

  it("an owner choosing no clients removes access; All clients restores it", async () => {
    const { owner, assigned, other, member } = await fixture("member")
    const put = (body: unknown) =>
      fetch(`${server.baseUrl}/api/members/${member.userId}/client-access`, {
        method: "PUT",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      })

    const none = await put({ clients: [] })
    expect(none.status, await none.clone().text()).toBe(200)
    expect(await none.json()).toMatchObject({
      allClients: false,
      noAccess: true,
    })
    expect(await status(member.cookie, assigned.reviewId)).toBe(404)
    expect(await status(member.cookie, other.reviewId)).toBe(404)

    const all = await put({ allClients: true })
    expect(all.status).toBe(200)
    expect(await status(member.cookie, assigned.reviewId)).toBe(200)
    expect(await status(member.cookie, other.reviewId)).toBe(200)
  })

  it("scope 'all' in another organisation does not widen an assigned-empty membership", async () => {
    const { owner, assigned, other, member } = await fixture("member")
    await admin`delete from location_member where user_id = ${member.userId}`
    // The same user is 'all' in a second organisation.
    const elsewhere = await createTestTenant(admin)
    organisations.push(elsewhere.organisationId)
    await admin`
      insert into member (organisation_id, user_id, role, can_publish, location_scope)
      values (${elsewhere.organisationId}, ${member.userId}, 'member', true, 'all')
    `
    expect(await status(member.cookie, assigned.reviewId)).toBe(404)
    expect(await status(member.cookie, other.reviewId)).toBe(404)
    // The owner of the first organisation still sees both.
    expect(await status(owner.cookie, assigned.reviewId)).toBe(200)
  })

  it("a row inserted under scope all narrows the member to it (0083)", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const first = await seedReview(admin, {
      organisationId: owner.organisationId,
    })
    const second = await seedReview(admin, {
      organisationId: owner.organisationId,
    })
    const member = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
    })
    expect(await status(member.cookie, second.reviewId)).toBe(200)
    // An acceptance written by code older than 0082: a row, scope untouched.
    await admin`
      insert into location_member (organisation_id, location_id, user_id)
      values (${owner.organisationId}, ${first.locationId}, ${member.userId})
    `
    expect(await status(member.cookie, first.reviewId)).toBe(200)
    expect(await status(member.cookie, second.reviewId)).toBe(404)
  })
})
