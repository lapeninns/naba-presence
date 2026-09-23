import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const BUCKET = "mybusinessaccountmanagement.googleapis.com"

/**
 * Two app servers stand in for two Vercel function instances. With a budget
 * of 6 requests a minute (one per ten-second window) and a five-second
 * request deadline, a second request anywhere in the fleet inside the same
 * window cannot be served in time and is deferred -- which only happens if
 * the instances share the budget.
 */
describeDatabase("shared Google request budget", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let first: Awaited<ReturnType<typeof startAppServer>>
  let second: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  const env = () => ({
    GOOGLE_API_PROXY_BASE: stub.baseUrl,
    GOOGLE_TIMEOUT_MS: "5000",
    GOOGLE_REQUESTS_PER_SECOND: "100",
    GOOGLE_API_REQUESTS_PER_MINUTE: "6",
  })

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    first = await startAppServer(env())
    second = await startAppServer(env())
  })

  afterAll(async () => {
    await first.stop()
    await second.stop()
    await stub.stop()
    await admin`delete from google_rate_bucket where bucket = ${BUCKET}`
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  beforeEach(async () => {
    stub.reset()
    await admin`delete from google_rate_bucket where bucket = ${BUCKET}`
  })

  async function tenant() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const { connectionId } = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    return { owner, connectionId }
  }

  function discover(
    server: Awaited<ReturnType<typeof startAppServer>>,
    cookie: string,
    connectionId: string
  ) {
    return fetch(
      `${server.baseUrl}/api/google/accounts?connection_id=${connectionId}`,
      { headers: { cookie } }
    )
  }

  it("holds a second instance to the budget the first one spent", async () => {
    const { owner, connectionId } = await tenant()
    stub.respond({ method: "GET", pathIncludes: "/v1/accounts" }, () => ({
      status: 200,
      json: { accounts: [] },
    }))

    const served = await discover(first, owner.cookie, connectionId)
    expect(served.status, await served.clone().text()).toBe(200)
    const deferred = await discover(second, owner.cookie, connectionId)
    expect(deferred.status).toBe(429)
    await expect(deferred.json()).resolves.toMatchObject({
      error: "google_rate_limited",
    })
    // The deferred request never reached Google.
    expect(
      stub.calls.filter((call) => call.path.includes("/v1/accounts"))
    ).toHaveLength(1)
  }, 60_000)

  it("stops every instance when Google answers 429", async () => {
    const { owner, connectionId } = await tenant()
    // Room for plenty, so only the throttle can stop the second call.
    await admin`delete from google_rate_bucket where bucket = ${BUCKET}`
    stub.respond({ method: "GET", pathIncludes: "/v1/accounts" }, () => ({
      status: 429,
      json: { error: { code: 429, status: "RESOURCE_EXHAUSTED" } },
    }))

    const throttled = await discover(first, owner.cookie, connectionId)
    expect(throttled.status).toBeGreaterThanOrEqual(400)
    const [bucket] = await admin<
      { blocked: boolean; throttledCount: number }[]
    >`
      select blocked_until > now() as blocked, throttled_count as "throttledCount"
      from google_rate_bucket where bucket = ${BUCKET}
    `
    expect(bucket).toMatchObject({ blocked: true })
    expect(bucket.throttledCount).toBeGreaterThanOrEqual(1)

    const callsBefore = stub.calls.length
    const held = await discover(second, owner.cookie, connectionId)
    expect(held.status).toBe(429)
    expect(stub.calls.length).toBe(callsBefore)
  }, 60_000)
})
