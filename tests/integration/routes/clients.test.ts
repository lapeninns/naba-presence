import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { createTestTenant, destroyTenants, seedReview } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

type ClientSummary = {
  id: string
  name: string
  slug: string
  health: string
  locationCount: number
  linkedCount: number
  openWork: { needsReply: number; awaitingApproval: number; failed: number }
  lastSyncAt: string | null
}

describeDatabase("clients", () => {
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

  async function fixture(options: Parameters<typeof createTestTenant>[1] = {}) {
    const tenant = await createTestTenant(admin, options)
    organisations.push(tenant.organisationId)
    return tenant
  }

  const request = (path: string, cookie: string, init: RequestInit = {}) =>
    fetch(`${server.baseUrl}${path}`, {
      ...init,
      headers: {
        cookie,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    })

  async function createClient(cookie: string, name: string) {
    const response = await request("/api/clients", cookie, {
      method: "POST",
      body: JSON.stringify({ name }),
    })
    const body = (await response.json()) as {
      client?: ClientSummary
      error?: string
    }
    return { response, body }
  }

  it("creates a client, slugs the name and lists it with zeroed counts", async () => {
    const owner = await fixture()
    const { response, body } = await createClient(
      owner.cookie,
      "Old Crown Group"
    )
    expect(response.status).toBe(200)
    expect(body.client).toMatchObject({
      name: "Old Crown Group",
      slug: "old-crown-group",
      locationCount: 0,
      linkedCount: 0,
    })
    // No locations yet is "not connected", not a failure state: the fix is to
    // finish setup, and the health word has to say so.
    expect(body.client?.health).toBe("not_connected")

    const list = await request("/api/clients", owner.cookie)
    const listed = (await list.json()) as {
      items: ClientSummary[]
      unassignedLocationCount: number
    }
    expect(listed.items.map((item) => item.name)).toEqual(["Old Crown Group"])
    expect(listed.unassignedLocationCount).toBe(0)
  })

  it("refuses a duplicate client name with a field error", async () => {
    const owner = await fixture()
    await createClient(owner.cookie, "Harbour Kitchen")
    const { response, body } = await createClient(
      owner.cookie,
      "Harbour Kitchen"
    )
    expect(response.status).toBe(409)
    expect(body.error).toBe("client_name_taken")
  })

  it("assigns locations and counts their open review work", async () => {
    const owner = await fixture()
    const { body } = await createClient(owner.cookie, "Bella Vita")
    const clientId = body.client!.id
    const seeded = await seedReview(admin, {
      organisationId: owner.organisationId,
      text: "Loud room, slow drinks.",
      rating: 3,
    })

    const assign = await request(
      `/api/clients/${clientId}/locations`,
      owner.cookie,
      {
        method: "POST",
        body: JSON.stringify({ locationIds: [seeded.locationId] }),
      }
    )
    expect(assign.status).toBe(200)

    const detail = await request(`/api/clients/${clientId}`, owner.cookie)
    const payload = (await detail.json()) as {
      client: ClientSummary
      locations: { locationId: string; clientId: string | null }[]
    }
    expect(payload.client.locationCount).toBe(1)
    // A freshly seeded review is `new`, which is the Needs reply queue.
    expect(payload.client.openWork.needsReply).toBe(1)
    expect(payload.locations.map((row) => row.locationId)).toEqual([
      seeded.locationId,
    ])
    expect(payload.locations[0]?.clientId).toBe(clientId)
  })

  it("reports the last check Google answered, not the last attempt", async () => {
    const owner = await fixture()
    const { body } = await createClient(owner.cookie, "Quiet Arms")
    const clientId = body.client!.id
    const seeded = await seedReview(admin, {
      organisationId: owner.organisationId,
    })
    await request(`/api/clients/${clientId}/locations`, owner.cookie, {
      method: "POST",
      body: JSON.stringify({ locationIds: [seeded.locationId] }),
    })
    // seedReview files the review against a location and a Google listing
    // but links neither; link them, as the listings step would.
    const [link] = await admin<{ externalLocationId: string }[]>`
      insert into location_link (organisation_id, external_location_id, location_id, is_active)
      select organisation_id, external_location_id, location_id, true
      from review where id = ${seeded.reviewId}
      returning external_location_id::text as "externalLocationId"
    `
    // A backfill that failed just now, and a reconcile that succeeded an hour ago.
    await admin`
      insert into sync_checkpoint (organisation_id, external_location_id, sync_type, status, last_succeeded_at)
      values
        (${owner.organisationId}, ${link.externalLocationId}, 'backfill', 'failed', null),
        (${owner.organisationId}, ${link.externalLocationId}, 'reconcile', 'succeeded', now() - interval '1 hour')
    `
    const detail = await request(`/api/clients/${clientId}`, owner.cookie)
    const payload = (await detail.json()) as { client: ClientSummary }
    const lastSync = new Date(payload.client.lastSyncAt!).getTime()
    expect(Date.now() - lastSync).toBeGreaterThan(55 * 60_000)
    expect(Date.now() - lastSync).toBeLessThan(65 * 60_000)
  })

  it("filters the inbox by client", async () => {
    const owner = await fixture()
    const { body } = await createClient(owner.cookie, "Fenland Dental")
    const clientId = body.client!.id
    const mine = await seedReview(admin, {
      organisationId: owner.organisationId,
      text: "Treated with real patience.",
      rating: 5,
    })
    const theirs = await seedReview(admin, {
      organisationId: owner.organisationId,
      text: "Somebody else's listing.",
      rating: 4,
    })
    await request(`/api/clients/${clientId}/locations`, owner.cookie, {
      method: "POST",
      body: JSON.stringify({ locationIds: [mine.locationId] }),
    })

    const response = await request(
      `/api/reviews?client_id=${clientId}`,
      owner.cookie
    )
    const listed = (await response.json()) as { items: { id: string }[] }
    const ids = listed.items.map((item) => item.id)
    expect(ids).toContain(mine.reviewId)
    expect(ids).not.toContain(theirs.reviewId)
  })

  it("keeps a client with locations out of the archive unless asked twice", async () => {
    const owner = await fixture()
    const { body } = await createClient(owner.cookie, "Mill Road Barbers")
    const clientId = body.client!.id
    const seeded = await seedReview(admin, {
      organisationId: owner.organisationId,
      rating: 5,
    })
    await request(`/api/clients/${clientId}/locations`, owner.cookie, {
      method: "POST",
      body: JSON.stringify({ locationIds: [seeded.locationId] }),
    })

    const blocked = await request(`/api/clients/${clientId}`, owner.cookie, {
      method: "PATCH",
      body: JSON.stringify({ archived: true }),
    })
    expect(blocked.status).toBe(409)
    expect(((await blocked.json()) as { error: string }).error).toBe(
      "client_has_locations"
    )

    const forced = await request(`/api/clients/${clientId}`, owner.cookie, {
      method: "PATCH",
      body: JSON.stringify({ archived: true, detachLocations: true }),
    })
    expect(forced.status).toBe(200)

    const [row] = await admin<{ clientId: string | null }[]>`
      select client_id::text as "clientId" from location where id = ${seeded.locationId}
    `
    expect(row?.clientId).toBeNull()
  })

  it("hides a client whose locations the member cannot see", async () => {
    const owner = await fixture()
    const { body } = await createClient(owner.cookie, "Cam Cycles")
    const clientId = body.client!.id
    const seeded = await seedReview(admin, {
      organisationId: owner.organisationId,
    })
    await request(`/api/clients/${clientId}/locations`, owner.cookie, {
      method: "POST",
      body: JSON.stringify({ locationIds: [seeded.locationId] }),
    })

    // A member with an assignment to some OTHER location has assignments, so
    // the "no rows means everything" default no longer applies to them.
    const memberId = randomUUID()
    const otherLocation = randomUUID()
    await admin`
      insert into app_user (id, email, display_name)
      values (${memberId}, ${`scoped-${memberId.slice(0, 8)}@nabapresence.test`}, 'Scoped member')
    `
    await admin`
      insert into member (organisation_id, user_id, role, can_publish)
      values (${owner.organisationId}, ${memberId}, 'member', false)
    `
    await admin`
      insert into location (id, organisation_id, name)
      values (${otherLocation}, ${owner.organisationId}, ${`Other ${otherLocation.slice(0, 8)}`})
    `
    await admin`
      insert into location_member (organisation_id, location_id, user_id, can_publish)
      values (${owner.organisationId}, ${otherLocation}, ${memberId}, false)
    `
    const token = randomUUID().replace(/-/g, "")
    await admin`
      insert into app_session (organisation_id, user_id, token_hash, expires_at)
      values (
        ${owner.organisationId},
        ${memberId},
        encode(digest(${token}, 'sha256'), 'hex'),
        now() + interval '1 day'
      )
    `

    const listed = await request("/api/clients", `naba_session=${token}`)
    const payload = (await listed.json()) as { items: ClientSummary[] }
    expect(payload.items.map((item) => item.id)).not.toContain(clientId)

    const detail = await request(
      `/api/clients/${clientId}`,
      `naba_session=${token}`
    )
    expect(detail.status).toBe(404)
  })

  it("derives the setup step from what exists", async () => {
    const owner = await fixture()
    const { body } = await createClient(owner.cookie, "Riverside Cafe")
    const response = await request(
      `/api/clients/${body.client!.id}/setup`,
      owner.cookie
    )
    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      setup: { nextStep: string; locationsLinked: number; backfill: string }
    }
    // Nothing connected yet, so the wizard resumes at the connect step.
    expect(payload.setup.nextStep).toBe("connect")
    expect(payload.setup.locationsLinked).toBe(0)
    expect(payload.setup.backfill).toBe("not_started")
  })
})
