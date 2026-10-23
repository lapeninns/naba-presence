import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { inOneAbuseWindow } from "../helpers/abuse-window"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

// ABUSE_POLICIES.google_discovery.user (lib/server/abuse-limits.ts).
const USER_LIMIT = 60
const WINDOW_SECONDS = 15 * 60

/**
 * W3-01: Google account and location discovery page all of Google and
 * rewrite the rows on every GET, so the routes are bounded per person and
 * per organisation, and the accounts are written in one statement.
 */
describeDatabase("Google discovery", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      ABUSE_LIMITS_ENABLED: "true",
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, organisations)
    await admin`
      delete from abuse_rate_bucket
      where scope in ('google_discovery_user', 'google_discovery_organisation')
    `
    await admin.end()
  })

  beforeEach(() => {
    stub.reset()
    stub.respond({ method: "GET", pathIncludes: "/v1/accounts" }, () => ({
      status: 200,
      json: {
        accounts: [
          {
            name: "accounts/discovery-a",
            accountName: "First account",
            type: "PERSONAL",
            role: "OWNER",
            permissionLevel: "OWNER_LEVEL",
          },
          { name: "accounts/discovery-b", accountName: "Second account" },
          // Listed twice: the later entry wins, as it did row by row.
          {
            name: "accounts/discovery-a",
            accountName: "First account, renamed",
            type: "PERSONAL",
            role: "OWNER",
            permissionLevel: "OWNER_LEVEL",
          },
        ],
      },
    }))
  })

  async function seedOwner() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    return { ...owner, ...connection }
  }

  function discoverAccounts(cookie: string) {
    return fetch(`${server.baseUrl}/api/google/accounts`, {
      headers: { cookie },
    })
  }

  it("writes every discovered account, once, in one pass", async () => {
    const owner = await seedOwner()
    const response = await discoverAccounts(owner.cookie)
    expect(response.status).toBe(200)
    const { accounts } = (await response.json()) as {
      accounts: { googleAccountName: string; accountName: string }[]
    }
    const discovered = accounts.filter((account) =>
      account.googleAccountName.startsWith("accounts/discovery-")
    )
    expect(
      discovered.map((account) => [
        account.googleAccountName,
        account.accountName,
      ])
    ).toEqual([
      ["accounts/discovery-a", "First account, renamed"],
      ["accounts/discovery-b", "Second account"],
    ])
    const [stored] = await admin<{ type: string; payload: unknown }[]>`
      select account_type as type, raw_payload as payload
      from google_account
      where organisation_id = ${owner.organisationId}
        and google_account_name = 'accounts/discovery-a'
    `
    expect(stored.type).toBe("PERSONAL")
    expect(stored.payload).toMatchObject({
      accountName: "First account, renamed",
    })

    // A second pass updates in place: no duplicates.
    expect((await discoverAccounts(owner.cookie)).status).toBe(200)
    const [{ count }] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from google_account
      where organisation_id = ${owner.organisationId}
    `
    expect(count).toBe(3) // the seeded account plus the two discovered
  })

  it("refuses discovery past the person's limit, before calling Google", async () => {
    await inOneAbuseWindow(admin, WINDOW_SECONDS, async () => {
      const owner = await seedOwner()
      for (let attempt = 0; attempt < USER_LIMIT; attempt += 1) {
        const response = await discoverAccounts(owner.cookie)
        expect(response.status).toBe(200)
      }
      const googleCalls = stub.calls.length

      const refused = await fetch(
        `${server.baseUrl}/api/google/locations?account_name=${encodeURIComponent(
          owner.googleAccountName
        )}`,
        { headers: { cookie: owner.cookie } }
      )
      expect(refused.status).toBe(429)
      expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0)
      expect(await refused.json()).toMatchObject({
        error: "discovery_rate_limited",
      })
      expect(stub.calls.length).toBe(googleCalls)

      // Another person is not held up by it.
      const other = await seedOwner()
      expect((await discoverAccounts(other.cookie)).status).toBe(200)
    })
    // One pass takes about 30 s under load (61 discovery requests); the
    // window check may run it twice.
  }, 120_000)
})
