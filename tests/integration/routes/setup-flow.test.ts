import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("client setup flow", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    // The connect-start route builds a Google authorization URL, which needs
    // a client id. CI has none, so without these the route answers 503 and
    // both OAuth-start cases below fail there while passing on a developer
    // machine whose .env carries real credentials.
    server = await startAppServer({
      GOOGLE_CLIENT_ID: "setup-flow-google-client",
      GOOGLE_CLIENT_SECRET: "setup-flow-google-secret",
    })
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function fixture() {
    const tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    const [client] = await admin<{ id: string }[]>`
      insert into client (organisation_id, name, slug)
      values (${tenant.organisationId}, 'Old Crown Group', 'old-crown-group')
      returning id::text as id
    `
    return { ...tenant, clientId: client!.id }
  }

  const request = (path: string, cookie: string, init: RequestInit = {}) =>
    fetch(`${server.baseUrl}${path}`, {
      ...init,
      headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) },
    })

  it("carries the client and return path through the OAuth start", async () => {
    const owner = await fixture()
    const response = await request("/api/google/connect/start", owner.cookie, {
      method: "POST",
      body: JSON.stringify({
        clientId: owner.clientId,
        returnTo: `/setup?client=${owner.clientId}&step=account`,
      }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { authorizationUrl: string }
    expect(body.authorizationUrl).toContain("accounts.google.com")
    // The client and return path ride in the signed state cookie, never the
    // authorization URL: Google echoes back only the nonce, and anything in
    // the query string would be attacker-influenced by the time we read it.
    expect(body.authorizationUrl).not.toContain(owner.clientId)
    const cookie = response.headers.get("set-cookie")
    expect(cookie).toContain("naba_google_oauth")
  })

  it("refuses a return path outside the connect flow", async () => {
    const owner = await fixture()
    const response = await request("/api/google/connect/start", owner.cookie, {
      method: "POST",
      body: JSON.stringify({ returnTo: "https://evil.test/steal" }),
    })
    // The value survives a round trip through Google and comes back as a
    // redirect the user never re-consented to, so it is replaced rather than
    // rejected — the connection itself is still worth completing.
    expect(response.status).toBe(200)
  })

  it("derives the setup step from what exists, and moves backwards when something breaks", async () => {
    const owner = await fixture()
    const before = await request(`/api/clients/${owner.clientId}/setup`, owner.cookie)
    const initial = (await before.json()) as { setup: { nextStep: string } }
    expect(initial.setup.nextStep).toBe("connect")

    // A connection alone is not enough: with no active Google account the
    // flow stops at the account step.
    const connectionId = randomUUID()
    await admin`
      insert into google_connection (id, organisation_id, google_subject, google_email, status, scope)
      values (
        ${connectionId}, ${owner.organisationId}, ${`subject-${connectionId}`},
        'ops@example.test', 'active', 'https://www.googleapis.com/auth/business.manage'
      )
    `
    const locationId = randomUUID()
    const externalId = randomUUID()
    await admin`
      insert into location (id, organisation_id, name, client_id)
      values (${locationId}, ${owner.organisationId}, 'Old Crown Girton', ${owner.clientId})
    `
    await admin`
      insert into external_location (
        id, organisation_id, google_connection_id, google_account_name,
        google_location_name, title
      )
      values (
        ${externalId}, ${owner.organisationId}, ${connectionId}, 'accounts/1',
        'locations/1', 'Old Crown Girton'
      )
    `
    await admin`
      insert into location_link (organisation_id, location_id, external_location_id, is_active)
      values (${owner.organisationId}, ${locationId}, ${externalId}, true)
    `

    const linked = await request(`/api/clients/${owner.clientId}/setup`, owner.cookie)
    const afterLink = (await linked.json()) as {
      setup: { nextStep: string; locationsLinked: number }
    }
    expect(afterLink.setup.locationsLinked).toBe(1)
    expect(afterLink.setup.nextStep).toBe("account")

    // Expiring the connection sends the flow back to connect, because a
    // client whose Google login lapsed is not "connected" just because it
    // once was.
    await admin`update google_connection set status = 'expired' where id = ${connectionId}`
    const broken = await request(`/api/clients/${owner.clientId}/setup`, owner.cookie)
    expect(((await broken.json()) as { setup: { nextStep: string } }).setup.nextStep).toBe(
      "connect"
    )
  })

  it("files a linked location under the client it was linked for", async () => {
    const owner = await fixture()
    const connectionId = randomUUID()
    const externalId = randomUUID()
    await admin`
      insert into google_connection (id, organisation_id, google_subject, google_email, status, scope)
      values (
        ${connectionId}, ${owner.organisationId}, ${`subject-${connectionId}`},
        'ops@example.test', 'active', 'https://www.googleapis.com/auth/business.manage'
      )
    `
    await admin`
      insert into external_location (
        id, organisation_id, google_connection_id, google_account_name,
        google_location_name, title
      )
      values (
        ${externalId}, ${owner.organisationId}, ${connectionId}, 'accounts/1',
        'locations/9', 'Harbour Kitchen Wells'
      )
    `

    const response = await request("/api/location-links", owner.cookie, {
      method: "POST",
      body: JSON.stringify({
        externalLocationId: externalId,
        timezone: "Europe/London",
        clientId: owner.clientId,
      }),
    })
    expect(response.status).toBe(201)

    const [row] = await admin<{ clientId: string | null }[]>`
      select client_id::text as "clientId"
      from location
      where organisation_id = ${owner.organisationId}
        and name = 'Harbour Kitchen Wells'
    `
    expect(row?.clientId).toBe(owner.clientId)
  })

  it("files an already-connected login under the client without a Google round trip", async () => {
    const owner = await fixture()
    const active = randomUUID()
    const expired = randomUUID()
    await admin`
      insert into google_connection (id, organisation_id, google_subject, google_email, status, scope)
      values
        (${active}, ${owner.organisationId}, ${`subject-${active}`}, 'shared@example.test',
          'active', 'https://www.googleapis.com/auth/business.manage'),
        (${expired}, ${owner.organisationId}, ${`subject-${expired}`}, 'old@example.test',
          'expired', 'https://www.googleapis.com/auth/business.manage')
    `
    const stranger = await createTestTenant(admin)
    organisations.push(stranger.organisationId)
    const foreign = randomUUID()
    await admin`
      insert into google_connection (id, organisation_id, google_subject, status, scope)
      values (${foreign}, ${stranger.organisationId}, ${`subject-${foreign}`}, 'active',
        'https://www.googleapis.com/auth/business.manage')
    `
    const attach = (connectionId: string) =>
      request(`/api/clients/${owner.clientId}/connections`, owner.cookie, {
        method: "POST",
        body: JSON.stringify({ connectionId }),
      })

    // Another organisation's login is invisible, not merely refused.
    expect((await attach(foreign)).status).toBe(404)
    // A lapsed login would fail account discovery on the very next step.
    const lapsed = await attach(expired)
    expect(lapsed.status).toBe(409)
    expect(await lapsed.json()).toMatchObject({ error: "google_reconnect_required" })

    const used = await attach(active)
    expect(used.status, await used.clone().text()).toBe(200)
    const body = (await used.json()) as {
      setup: { nextStep: string; connection: { id: string } | null }
    }
    expect(body.setup.connection?.id).toBe(active)
    expect(body.setup.nextStep).toBe("account")
    // Picking it twice is harmless.
    expect((await attach(active)).status).toBe(200)

    const summary = await request(`/api/clients/${owner.clientId}`, owner.cookie)
    const client = (await summary.json()) as {
      client: { connections: { id: string }[] }
    }
    expect(client.client.connections.map((connection) => connection.id)).toEqual([active])
  })
})
