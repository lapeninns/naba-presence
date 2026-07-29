import { randomUUID } from "node:crypto"

import postgres from "postgres"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("scheduler advisory leases", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    stub = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      GOOGLE_TIMEOUT_MS: "3000",
    })
  })

  afterEach(async () => {
    await destroyTenants(admin, organisations.splice(0))
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await admin.end()
  })

  async function linkedFixture() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    return { owner, linked }
  }

  function cronPost(path: string) {
    return fetch(`${server.baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: "Bearer route-harness-cron-secret",
        "content-type": "application/json",
      },
      body: "{}",
    })
  }

  it("skips jobs while another session holds the jobs lease", async () => {
    const { owner, linked } = await linkedFixture()
    stub.reset()
    stub.respond(
      { method: "GET", pathIncludes: "/reviews" },
      () => ({ status: 200, json: { reviews: [] } })
    )
    await admin`
      insert into processed_webhook_event (
        organisation_id,
        external_location_id,
        provider,
        external_event_id,
        event_type,
        payload_hash,
        status,
        retry_count,
        next_attempt_at
      )
      values (
        ${owner.organisationId},
        ${linked.externalLocationId},
        'google_pubsub',
        ${randomUUID()},
        'NEW_REVIEW',
        ${randomUUID()},
        'failed',
        1,
        now() - interval '1 second'
      )
    `

    const lock = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    await lock`select pg_advisory_lock(hashtext('naba:jobs'))`
    try {
      const skipped = await cronPost("/api/jobs/run")
      expect(skipped.status, await skipped.clone().text()).toBe(200)
      expect(await skipped.json()).toEqual({ skipped: true })
      const [event] = await admin<{ status: string }[]>`
        select status
        from processed_webhook_event
        where organisation_id = ${owner.organisationId}
      `
      expect(event.status).toBe("failed")
    } finally {
      await lock`select pg_advisory_unlock(hashtext('naba:jobs'))`
      await lock.end()
    }

    const completed = await cronPost("/api/jobs/run")
    expect(completed.status, await completed.clone().text()).toBe(200)
    expect(await completed.json()).toMatchObject({ webhooks: 1 })
  })

  it("allows only one concurrent fleet reconciliation", async () => {
    await linkedFixture()
    stub.reset()
    stub.respond(
      { method: "GET", pathIncludes: "/reviews" },
      () => ({
        status: 200,
        json: { reviews: [] },
        delayMs: 300,
      })
    )

    const responses = await Promise.all([
      cronPost("/api/sync/reconcile"),
      cronPost("/api/sync/reconcile"),
    ])
    expect(responses.every((response) => response.status === 200)).toBe(true)
    const bodies = await Promise.all(
      responses.map(
        (response) =>
          response.json() as Promise<
            { skipped: true } | { processed: number }
          >
      )
    )
    expect(
      bodies.filter((body) => "skipped" in body).length
    ).toBe(1)
    const completed = bodies.filter(
      (body): body is { processed: number } => "processed" in body
    )
    expect(completed).toHaveLength(1)
    expect(completed[0]?.processed).toBeGreaterThanOrEqual(1)
    expect(
      stub.calls.filter(
        (call) => call.method === "GET" && call.path.includes("/reviews")
      )
    ).toHaveLength(1)
  })
})
