import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

/**
 * The plan's location limit (plan P07-S3, trigger 0110) through the real
 * linking surfaces: the manual link route and the automatic link after a
 * Google login both stop at the limit with 402 location_limit_reached,
 * re-linking an already linked Google location takes no new seat, and a
 * scheduled downgrade binds new links without unlinking anything.
 */
describeDatabase("location limit", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const tenants: string[] = []
  const planCodes: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      GOOGLE_CLIENT_ID: "location-limit-client",
      GOOGLE_CLIENT_SECRET: "location-limit-secret",
      GOOGLE_REQUESTS_PER_SECOND: "100",
      GOOGLE_TIMEOUT_MS: "3000",
      SYNC_ENABLED: "false",
      BILLING_ENFORCEMENT_ENABLED: "true",
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, tenants)
    if (planCodes.length) {
      await admin`delete from billing_plan where code in ${admin(planCodes)}`
    }
    await admin.end()
  })

  async function plan(limit: number): Promise<string> {
    const code = `p07s3_${randomUUID().replaceAll("-", "").slice(0, 16)}`
    planCodes.push(code)
    const [row] = await admin<{ id: string }[]>`
      insert into billing_plan (
        code, version, workspace_mode, environment, name, stripe_price_id,
        location_limit, ai_draft_credits_per_period, is_test_offer
      )
      values (
        ${code}, 1, 'agency', 'test', 'Limit test',
        ${`price_${code.replaceAll("_", "")}`}, ${limit}, 10, true
      )
      returning id::text as id
    `
    return row.id
  }

  /** An active, enforced subscription on a plan with this location limit. */
  async function subscribedTenant(limit: number) {
    const owner = await createTestTenant(admin)
    tenants.push(owner.organisationId)
    const planId = await plan(limit)
    const id = randomUUID().replaceAll("-", "")
    await admin`
      update organisation_billing
      set state = 'active',
          plan_id = ${planId},
          environment = 'test',
          stripe_customer_id = ${`cus_${id}`},
          stripe_subscription_id = ${`sub_${id}`},
          current_period_start = now() - interval '1 day',
          current_period_end = now() + interval '29 days',
          first_payment_succeeded = true,
          enforcement_enabled = true
      where organisation_id = ${owner.organisationId}
    `
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    return { owner, connection }
  }

  async function googleLocation(
    organisationId: string,
    connection: { connectionId: string; googleAccountName: string }
  ): Promise<string> {
    const id = randomUUID()
    await admin`
      insert into external_location (
        id, organisation_id, google_connection_id, google_account_name,
        google_location_name, title, verified
      ) values (
        ${id}, ${organisationId}, ${connection.connectionId},
        ${connection.googleAccountName}, ${`locations/limit-${id}`},
        ${`Limit location ${id.slice(0, 8)}`}, true
      )
    `
    return id
  }

  function link(cookie: string, body: Record<string, unknown>) {
    return fetch(`${server.baseUrl}/api/location-links`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  async function activeLinks(organisationId: string): Promise<number> {
    const [row] = await admin<{ n: number }[]>`
      select count(*)::int as n from location_link
      where organisation_id = ${organisationId} and is_active
    `
    return row.n
  }

  it("stops the link route at the limit, and lets an active location be linked again", async () => {
    const { owner, connection } = await subscribedTenant(2)
    const first = await googleLocation(owner.organisationId, connection)
    const second = await googleLocation(owner.organisationId, connection)
    const third = await googleLocation(owner.organisationId, connection)

    for (const externalLocationId of [first, second]) {
      const response = await link(owner.cookie, { externalLocationId })
      expect(response.status, await response.clone().text()).toBe(201)
    }
    const refused = await link(owner.cookie, { externalLocationId: third })
    expect(refused.status, await refused.clone().text()).toBe(402)
    expect(await refused.json()).toMatchObject({
      error: "location_limit_reached",
      details: { limit: 2 },
    })
    expect(await activeLinks(owner.organisationId)).toBe(2)

    // The same Google location again, onto the location it already has.
    const [current] = await admin<{ locationId: string }[]>`
      select location_id::text as "locationId" from location_link
      where external_location_id = ${second}
    `
    const again = await link(owner.cookie, {
      externalLocationId: second,
      locationId: current.locationId,
    })
    expect(again.status, await again.clone().text()).toBe(201)
    expect(await activeLinks(owner.organisationId)).toBe(2)
  })

  it("binds a scheduled downgrade on new links only", async () => {
    const { owner, connection } = await subscribedTenant(3)
    for (let n = 0; n < 2; n += 1) {
      const externalLocationId = await googleLocation(
        owner.organisationId,
        connection
      )
      const response = await link(owner.cookie, { externalLocationId })
      expect(response.status, await response.clone().text()).toBe(201)
    }
    const lower = await plan(1)
    await admin`
      update organisation_billing
      set pending_plan_id = ${lower},
          pending_effective_at = now() + interval '29 days'
      where organisation_id = ${owner.organisationId}
    `
    const refused = await link(owner.cookie, {
      externalLocationId: await googleLocation(
        owner.organisationId,
        connection
      ),
    })
    expect(refused.status, await refused.clone().text()).toBe(402)
    expect(await refused.json()).toMatchObject({
      error: "location_limit_reached",
      details: { limit: 1 },
    })
    // Nothing was unlinked to fit the lower limit.
    expect(await activeLinks(owner.organisationId)).toBe(2)
  })

  it("keeps the connection but links nothing when automatic setup would pass the limit", async () => {
    const { owner, connection } = await subscribedTenant(1)
    await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const marker = randomUUID().slice(0, 8)
    stub.reset()
    stub.respond({ method: "POST", pathEndsWith: "/token" }, () => ({
      status: 200,
      json: {
        access_token: "limit-access-token",
        expires_in: 3600,
        refresh_token: "limit-refresh-token",
        scope:
          "openid email profile https://www.googleapis.com/auth/business.manage",
        token_type: "Bearer",
      },
    }))
    stub.respond({ method: "GET", pathEndsWith: "/v1/userinfo" }, () => ({
      status: 200,
      json: {
        sub: `limit-${owner.organisationId}`,
        email: owner.email,
        email_verified: true,
      },
    }))
    stub.respond({ method: "GET", pathIncludes: "/v1/accounts" }, () => ({
      status: 200,
      json: {
        accounts: [
          {
            name: `accounts/limit-${marker}`,
            accountName: "Limit account",
            type: "PERSONAL",
            role: "OWNER",
            permissionLevel: "OWNER_LEVEL",
          },
        ],
      },
    }))
    stub.respond(
      { method: "GET", pathIncludes: `/accounts/limit-${marker}/locations` },
      () => ({
        status: 200,
        json: {
          locations: [
            {
              name: `locations/limit-auto-${marker}`,
              title: `Limit Inn ${marker}`,
              metadata: { hasVoiceOfMerchant: true },
            },
          ],
        },
      })
    )
    const start = await fetch(`${server.baseUrl}/api/google/connect/start`, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: "{}",
    })
    expect(start.status, await start.clone().text()).toBe(200)
    const { authorizationUrl } = z
      .object({ authorizationUrl: z.url() })
      .parse(await start.json())
    const oauthCookie = start.headers.get("set-cookie")?.split(";", 1)[0]
    if (!oauthCookie) throw new TypeError("OAuth cookie was not set")

    const callback = await fetch(`${server.baseUrl}/api/auth/callback/google`, {
      method: "POST",
      headers: {
        cookie: `${owner.cookie}; ${oauthCookie}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        code: "limit-code",
        state: new URL(authorizationUrl).searchParams.get("state"),
      }),
    })
    expect(callback.status, await callback.clone().text()).toBe(200)
    expect(await callback.json()).toMatchObject({
      setup: { kind: "location_limit_reached", limit: 1 },
    })
    expect(await activeLinks(owner.organisationId)).toBe(1)
    const [linked] = await admin<{ n: number }[]>`
      select count(*)::int as n
      from external_location e
      join location_link ll on ll.external_location_id = e.id
      where e.organisation_id = ${owner.organisationId}
        and e.google_location_name = ${`locations/limit-auto-${marker}`}
    `
    expect(linked.n).toBe(0)
  })
})
