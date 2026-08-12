import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("automatic Google review setup", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>> | undefined
  const organisations: string[] = []

  beforeAll(async () => {
    const directDatabaseUrl = process.env.DIRECT_DATABASE_URL
    if (!directDatabaseUrl) {
      throw new TypeError("DIRECT_DATABASE_URL is required")
    }
    admin = postgres(directDatabaseUrl, { max: 1 })
    stub = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      GOOGLE_CLIENT_ID: "automatic-setup-client",
      GOOGLE_CLIENT_SECRET: "automatic-setup-secret",
      GOOGLE_REQUESTS_PER_SECOND: "100",
      GOOGLE_TIMEOUT_MS: "3000",
      SYNC_ENABLED: "false",
    })
  })

  afterAll(async () => {
    if (server) await server.stop()
    await stub.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("activates, links, and queues reviews when Google returns one account and one location", async () => {
    // Given: an owner completes OAuth for one manageable Business Profile.
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    stub.reset()
    stub.respond({ method: "POST", pathEndsWith: "/token" }, () => ({
      status: 200,
      json: {
        access_token: "automatic-access-token",
        expires_in: 3600,
        refresh_token: "automatic-refresh-token",
        scope: "openid email profile business.manage",
        token_type: "Bearer",
      },
    }))
    stub.respond({ method: "GET", pathEndsWith: "/v1/userinfo" }, () => ({
      status: 200,
      json: {
        sub: `automatic-${owner.organisationId}`,
        email: owner.email,
        email_verified: true,
      },
    }))
    stub.respond({ method: "GET", pathIncludes: "/v1/accounts" }, () => ({
      status: 200,
      json: {
        accounts: [
          {
            name: "accounts/automatic",
            accountName: "Automatic account",
            type: "PERSONAL",
            role: "OWNER",
            permissionLevel: "OWNER_LEVEL",
          },
        ],
      },
    }))
    stub.respond(
      { method: "GET", pathIncludes: "/accounts/automatic/locations" },
      () => ({
        status: 200,
        json: {
          locations: [
            {
              name: "locations/automatic",
              title: "Automatic Inn",
              storefrontAddress: {
                addressLines: ["1 Automatic Lane"],
                locality: "Cambridge",
                postalCode: "CB1 1AA",
              },
              metadata: { hasVoiceOfMerchant: true },
            },
          ],
        },
      })
    )
    if (!server) throw new Error("Integration server did not start")
    const start = await fetch(`${server.baseUrl}/api/google/connect/start`, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: "{}",
    })
    const { authorizationUrl } = z
      .object({
        authorizationUrl: z.url(),
      })
      .parse(await start.json())
    const oauthCookie = start.headers.get("set-cookie")?.split(";", 1)[0]
    if (!oauthCookie) throw new TypeError("OAuth cookie was not set")

    // When: Google returns to the callback.
    const callback = await fetch(`${server.baseUrl}/api/auth/callback/google`, {
      method: "POST",
      headers: {
        cookie: `${owner.cookie}; ${oauthCookie}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        code: "automatic-code",
        state: new URL(authorizationUrl).searchParams.get("state"),
      }),
    })

    // Then: no further account, location, or sync action is required.
    expect(callback.status, await callback.clone().text()).toBe(200)
    expect(await callback.json()).toMatchObject({
      setup: {
        kind: "automatic",
        accountName: "accounts/automatic",
        locationName: "locations/automatic",
      },
    })
    const [state] = await admin<
      {
        active: boolean
        linkId: string | null
        checkpointStatus: string | null
      }[]
    >`
      select
        ga.is_active as active,
        ll.id::text as "linkId",
        sc.status as "checkpointStatus"
      from google_account ga
      join external_location e
        on e.organisation_id = ga.organisation_id
       and e.google_account_name = ga.google_account_name
      left join location_link ll
        on ll.external_location_id = e.id
       and ll.is_active = true
      left join sync_checkpoint sc
        on sc.external_location_id = e.id
       and sc.sync_type = 'backfill'
      where ga.organisation_id = ${owner.organisationId}
    `
    expect(state).toMatchObject({
      active: true,
      linkId: expect.any(String),
      checkpointStatus: "pending",
    })
  })
})
