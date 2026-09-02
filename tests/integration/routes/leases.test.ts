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

  function cronPost(path: string, body: unknown = {}) {
    return fetch(`${server.baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: "Bearer route-harness-cron-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    })
  }

  async function tickHeartbeat(name: string) {
    const [row] = await admin<{ beatAt: Date }[]>`
      select beat_at as "beatAt" from ops_heartbeat where name = ${name}
    `
    return row?.beatAt ?? null
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

    const before = await tickHeartbeat("jobs")
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
      // A lock miss did no work, so it must leave no trace of a completed
      // tick: a heartbeat written here would report a wedged lease as liveness.
      expect(await tickHeartbeat("jobs")).toEqual(before)
    } finally {
      await lock`select pg_advisory_unlock(hashtext('naba:jobs'))`
      await lock.end()
    }

    const completed = await cronPost("/api/jobs/run")
    expect(completed.status, await completed.clone().text()).toBe(200)
    expect(await completed.json()).toMatchObject({ webhooks: 1 })
    const after = await tickHeartbeat("jobs")
    expect(after).not.toBeNull()
    if (before) expect(after!.getTime()).toBeGreaterThan(before.getTime())
  })

  it("allows only one concurrent fleet reconciliation", async () => {
    const { linked } = await linkedFixture()
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
    // The skip envelope now carries `processed: 0` so a lock miss cannot read
    // as a finished walk, so `"processed" in body` no longer discriminates.
    const completed = bodies.filter(
      (body): body is { processed: number } => !("skipped" in body)
    )
    expect(completed).toHaveLength(1)
    expect(completed[0]?.processed).toBeGreaterThanOrEqual(1)
    expect(
      stub.calls.filter(
        (call) =>
          call.method === "GET" &&
          call.path.includes(linked.googleLocationName)
      )
    ).toHaveLength(1)
  })

  it("reaches the second tenant by following the returned cursor", async () => {
    const first = await linkedFixture()
    const second = await linkedFixture()
    stub.reset()
    stub.respond({ method: "GET", pathIncludes: "/reviews" }, () => ({
      status: 200,
      json: { reviews: [] },
    }))

    // One organisation per page is the shape a scheduler tick degrades to
    // when a page overruns its budget: everything after the first tenant is
    // reachable only if the caller resumes from nextCursor instead of
    // restarting at the head.
    const reconciled = async (organisationId: string) => {
      const [row] = await admin<{ count: number }[]>`
        select count(*)::int as count
        from audit_log
        where organisation_id = ${organisationId}
          and action = 'sync.reconcile.completed'
      `
      return row.count > 0
    }

    const page = async (cursor?: string) => {
      const response = await cronPost("/api/sync/reconcile", {
        organisationCursor: cursor,
        maxOrganisations: 1,
      })
      expect(response.status, await response.clone().text()).toBe(200)
      return (await response.json()) as { nextCursor: string | null }
    }

    let cursor = (await page()).nextCursor
    expect(cursor).not.toBeNull()
    for (let pages = 0; pages < 50 && cursor; pages += 1) {
      if (
        (await reconciled(first.owner.organisationId)) &&
        (await reconciled(second.owner.organisationId))
      ) {
        break
      }
      cursor = (await page(cursor)).nextCursor
    }

    expect(await reconciled(first.owner.organisationId)).toBe(true)
    expect(await reconciled(second.owner.organisationId)).toBe(true)
  })
})
