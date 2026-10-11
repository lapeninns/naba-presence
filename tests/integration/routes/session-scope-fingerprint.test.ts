import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedMemberUser,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

// The session projection's scopeFingerprint is what the client resets its
// query cache on (lib/queries/scope-reset.ts). It must move with every change
// to what the membership may see or do, and stay put otherwise.
describeDatabase("session scope fingerprint", () => {
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

  async function fingerprint(cookie: string): Promise<string> {
    const response = await fetch(`${server.baseUrl}/api/session`, {
      headers: { cookie },
    })
    expect(response.status, await response.clone().text()).toBe(200)
    const body = (await response.json()) as {
      session: { scopeFingerprint?: string } | null
    }
    expect(body.session?.scopeFingerprint).toMatch(/^[0-9a-f]{32}$/)
    return body.session!.scopeFingerprint!
  }

  async function addLocation(organisationId: string): Promise<string> {
    const id = randomUUID()
    await admin`
      insert into location (id, organisation_id, name)
      values (${id}, ${organisationId}, ${`Scope ${id.slice(0, 8)}`})
    `
    return id
  }

  it("moves with grants, grant publish rights and role, and only with them", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const first = await addLocation(owner.organisationId)
    const second = await addLocation(owner.organisationId)
    const member = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      assignLocationId: first,
    })

    const initial = await fingerprint(member.cookie)
    expect(await fingerprint(member.cookie)).toBe(initial)

    // Unrelated changes leave it alone.
    await admin`update organisation set name = 'Renamed' where id = ${owner.organisationId}`
    expect(await fingerprint(member.cookie)).toBe(initial)

    await admin`
      insert into location_member (organisation_id, location_id, user_id, can_publish)
      values (${owner.organisationId}, ${second}, ${member.userId}, false)
    `
    const widened = await fingerprint(member.cookie)
    expect(widened).not.toBe(initial)

    await admin`
      update location_member set can_publish = true
      where user_id = ${member.userId} and location_id = ${second}
    `
    const publishing = await fingerprint(member.cookie)
    expect(publishing).not.toBe(widened)

    await admin`
      delete from location_member
      where user_id = ${member.userId} and location_id = ${second}
    `
    expect(await fingerprint(member.cookie)).toBe(initial)

    await admin`
      update member set role = 'viewer'
      where organisation_id = ${owner.organisationId} and user_id = ${member.userId}
    `
    expect(await fingerprint(member.cookie)).not.toBe(initial)
  })

  it("is the same token the organisation switch answers with", async () => {
    const tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    const other = randomUUID()
    organisations.push(other)
    await admin`
      insert into organisation (id, slug, name)
      values (${other}, ${`scope-${other.slice(0, 12)}`}, 'Other organisation')
    `
    await admin`
      insert into member (organisation_id, user_id, role, can_publish)
      values (${other}, ${tenant.userId}, 'admin', false)
    `
    const response = await fetch(`${server.baseUrl}/api/session/switch`, {
      method: "POST",
      headers: {
        cookie: tenant.cookie,
        "content-type": "application/json",
        origin: server.baseUrl,
      },
      body: JSON.stringify({ organisationId: other }),
    })
    expect(response.status, await response.clone().text()).toBe(200)
    const switched = (await response.json()) as {
      session: { scopeFingerprint?: string }
    }
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .find((value) => value.startsWith("naba_session="))!
    expect(switched.session.scopeFingerprint).toBe(await fingerprint(cookie))
  })
})
