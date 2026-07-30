import { createHash, randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex")

describeDatabase("organisation switching", () => {
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

  it("lists memberships and rotates the session into another organisation", async () => {
    const tenantA = await createTestTenant(admin)
    organisations.push(tenantA.organisationId)
    const organisationB = randomUUID()
    organisations.push(organisationB)
    await admin`
      insert into organisation (id, slug, name)
      values (
        ${organisationB},
        ${`switch-${organisationB.slice(0, 12)}`},
        'Second organisation'
      )
    `
    await admin`
      insert into member (organisation_id, user_id, role, can_publish)
      values (${organisationB}, ${tenantA.userId}, 'admin', true)
    `

    const organisationsResponse = await fetch(
      `${server.baseUrl}/api/organisations`,
      { headers: { cookie: tenantA.cookie } }
    )
    expect(
      organisationsResponse.status,
      await organisationsResponse.clone().text()
    ).toBe(200)
    expect(await organisationsResponse.json()).toEqual({
      items: expect.arrayContaining([
        {
          organisationId: tenantA.organisationId,
          name: "Harness tenant",
          role: "owner",
        },
        {
          organisationId: organisationB,
          name: "Second organisation",
          role: "admin",
        },
      ]),
    })

    const switchResponse = await fetch(
      `${server.baseUrl}/api/session/switch`,
      {
        method: "POST",
        headers: {
          cookie: tenantA.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ organisationId: organisationB }),
      }
    )
    expect(
      switchResponse.status,
      await switchResponse.clone().text()
    ).toBe(200)
    expect(await switchResponse.json()).toMatchObject({
      session: {
        organisationId: organisationB,
        organisationName: "Second organisation",
        role: "admin",
      },
    })
    const newCookie = switchResponse.headers
      .get("set-cookie")
      ?.split(";", 1)[0]
    expect(newCookie).toMatch(/^naba_session=/)
    const sessionResponse = await fetch(`${server.baseUrl}/api/session`, {
      headers: { cookie: newCookie! },
    })
    expect(sessionResponse.status).toBe(200)
    expect(await sessionResponse.json()).toMatchObject({
      session: { organisationId: organisationB },
    })
    const oldToken = tenantA.cookie.split("=", 2)[1]
    const [oldSession] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from app_session
      where token_hash = ${tokenHash(oldToken)}
    `
    expect(oldSession.count).toBe(0)
  })

  it("forbids switching without a membership", async () => {
    const current = await createTestTenant(admin)
    const inaccessible = await createTestTenant(admin)
    organisations.push(
      current.organisationId,
      inaccessible.organisationId
    )

    const response = await fetch(`${server.baseUrl}/api/session/switch`, {
      method: "POST",
      headers: {
        cookie: current.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        organisationId: inaccessible.organisationId,
      }),
    })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe(
      "organisation_membership_required"
    )
  })
})
