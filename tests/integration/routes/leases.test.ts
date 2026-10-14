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

  type LedgerRow = {
    beatAt: Date | null
    lastStartedAt: Date | null
    lastSkippedAt: Date | null
    consecutiveSkips: number
    lastFailedAt: Date | null
    lastErrorCode: string | null
    lastManualCompletedAt: Date | null
    lastCycleCompletedAt: Date | null
    registeredAt: Date
  }

  async function ledger(name: string) {
    const [row] = await admin<LedgerRow[]>`
      select
        beat_at as "beatAt",
        last_started_at as "lastStartedAt",
        last_skipped_at as "lastSkippedAt",
        consecutive_skips as "consecutiveSkips",
        last_failed_at as "lastFailedAt",
        last_error_code as "lastErrorCode",
        last_manual_completed_at as "lastManualCompletedAt",
        last_cycle_completed_at as "lastCycleCompletedAt",
        registered_at as "registeredAt"
      from ops_heartbeat
      where name = ${name}
    `
    return row
  }

  it("seeds a registered ledger row for every tick", async () => {
    const rows = await admin<{ name: string }[]>`
      select name from ops_heartbeat
      where registered_at is not null
    `
    expect(rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "jobs",
        "reconcile",
        "retention",
        "performance",
        "keywords",
        "presence-resources",
        "sweep",
        "health",
      ])
    )
  })

  it("counts lock skips in a row and ends the streak when the lease is taken", async () => {
    await admin`
      update ops_heartbeat set consecutive_skips = 0 where name = 'sweep'
    `
    const before = await ledger("sweep")
    const lock = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    await lock`select pg_advisory_lock(hashtext('naba:sweep'))`
    try {
      for (let fire = 0; fire < 2; fire += 1) {
        const skipped = await cronPost("/api/sync/sweep")
        expect(skipped.status, await skipped.clone().text()).toBe(200)
        expect(await skipped.json()).toMatchObject({ skipped: true })
      }
      const wedged = await ledger("sweep")
      expect(wedged.consecutiveSkips).toBe(2)
      expect(wedged.lastSkippedAt).not.toBeNull()
      // A skip did nothing, so neither the heartbeat nor the start moves.
      expect(wedged.beatAt).toEqual(before.beatAt)
      expect(wedged.lastStartedAt).toEqual(before.lastStartedAt)
    } finally {
      await lock`select pg_advisory_unlock(hashtext('naba:sweep'))`
      await lock.end()
    }

    const completed = await cronPost("/api/sync/sweep")
    expect(completed.status, await completed.clone().text()).toBe(200)
    const after = await ledger("sweep")
    expect(after.consecutiveSkips).toBe(0)
    expect(after.lastStartedAt).not.toBeNull()
    expect(after.beatAt).not.toBeNull()
    if (before.beatAt) {
      expect(after.beatAt!.getTime()).toBeGreaterThan(before.beatAt.getTime())
    }
  })

  it("records a failed run without moving the heartbeat", async () => {
    const paused = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      RETENTION_ENABLED: "false",
    })
    try {
      const before = await ledger("retention")
      const response = await fetch(`${paused.baseUrl}/api/cron/retention`, {
        method: "POST",
        headers: { authorization: "Bearer route-harness-cron-secret" },
      })
      expect(response.status, await response.clone().text()).toBe(503)
      const after = await ledger("retention")
      expect(after.lastFailedAt).not.toBeNull()
      expect(after.lastErrorCode).toBe("retention_paused")
      expect(after.lastStartedAt).not.toBeNull()
      expect(after.beatAt).toEqual(before.beatAt)
      expect(after.lastCycleCompletedAt).toEqual(before.lastCycleCompletedAt)
    } finally {
      await paused.stop()
    }
  })

  it("records the dispatcher finishing a retention cycle as a completed cycle", async () => {
    // A running cycle resumes at any hour, so the test does not depend on
    // the wall clock being past 03:00 UTC.
    await admin`delete from retention_cycle`
    await admin`
      insert into retention_cycle (cycle_date) values ('2000-01-01')
    `
    const before = await ledger("retention")
    let completed = false
    for (let fire = 0; fire < 20 && !completed; fire += 1) {
      const response = await cronPost("/api/cron/retention")
      expect(response.status, await response.clone().text()).toBe(200)
      const body = (await response.json()) as { completed: boolean }
      completed = body.completed
      const after = await ledger("retention")
      expect(after.beatAt).not.toBeNull()
      if (!completed) {
        // A fire that did not finish the cycle does not report one.
        expect(after.lastCycleCompletedAt).toEqual(before.lastCycleCompletedAt)
      }
    }
    expect(completed).toBe(true)
    const after = await ledger("retention")
    expect(after.lastCycleCompletedAt).not.toBeNull()
    if (before.lastCycleCompletedAt) {
      expect(after.lastCycleCompletedAt!.getTime()).toBeGreaterThan(
        before.lastCycleCompletedAt.getTime()
      )
    }
  })

  it("keeps a hand-run retention page off the cron heartbeat and the cycle", async () => {
    const before = await ledger("retention")
    const response = await cronPost("/api/cron/retention?batch_size=100&cursor=")
    expect(response.status, await response.clone().text()).toBe(200)
    const after = await ledger("retention")
    expect(after.lastManualCompletedAt).not.toBeNull()
    expect(after.beatAt).toEqual(before.beatAt)
    expect(after.lastStartedAt).toEqual(before.lastStartedAt)
    expect(after.lastCycleCompletedAt).toEqual(before.lastCycleCompletedAt)
  })

  it("keeps a manual refresh off the cron heartbeat", async () => {
    const { owner } = await linkedFixture()
    stub.reset()
    const before = await ledger("performance")
    const response = await fetch(`${server.baseUrl}/api/sync/performance`, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(response.status, await response.clone().text()).toBe(200)
    const after = await ledger("performance")
    expect(after.lastManualCompletedAt).not.toBeNull()
    if (before.lastManualCompletedAt) {
      expect(after.lastManualCompletedAt!.getTime()).toBeGreaterThan(
        before.lastManualCompletedAt.getTime()
      )
    }
    expect(after.beatAt).toEqual(before.beatAt)
    expect(after.lastStartedAt).toEqual(before.lastStartedAt)
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

  describe("Sync now locks only its own organisation (W8-08)", () => {
    function syncNow(cookie: string) {
      return fetch(`${server.baseUrl}/api/sync/reconcile`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      })
    }

    function respondSlowly() {
      stub.reset()
      stub.respond({ method: "GET", pathIncludes: "/reviews" }, () => ({
        status: 200,
        json: { reviews: [] },
        delayMs: 300,
      }))
    }

    it("lets two tenants sync at once", async () => {
      const first = await linkedFixture()
      const second = await linkedFixture()
      respondSlowly()

      const responses = await Promise.all([
        syncNow(first.owner.cookie),
        syncNow(second.owner.cookie),
      ])
      for (const response of responses) {
        expect(response.status, await response.clone().text()).toBe(200)
        const body = (await response.json()) as {
          skipped?: true
          processed: number
        }
        expect(body.skipped).toBeUndefined()
        expect(body.processed).toBe(1)
      }
      for (const fixture of [first, second]) {
        expect(
          stub.calls.filter(
            (call) =>
              call.method === "GET" &&
              call.path.includes(fixture.linked.googleLocationName)
          )
        ).toHaveLength(1)
      }
    })

    it("skips while the same organisation's sync holds its lock, and never waits on the fleet's", async () => {
      const held = await linkedFixture()
      const free = await linkedFixture()
      respondSlowly()
      const lock = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
      await lock`
        select
          pg_advisory_lock(hashtext(${`naba:reconcile:${held.owner.organisationId}`})),
          pg_advisory_lock(hashtext('naba:reconcile'))
      `
      try {
        const skipped = await syncNow(held.owner.cookie)
        expect(skipped.status, await skipped.clone().text()).toBe(200)
        expect(await skipped.json()).toMatchObject({ skipped: true })

        const ran = await syncNow(free.owner.cookie)
        expect(ran.status, await ran.clone().text()).toBe(200)
        expect(await ran.json()).not.toHaveProperty("skipped")

        // The cron walk still takes the fleet lease.
        const cron = await cronPost("/api/sync/reconcile")
        expect(await cron.json()).toMatchObject({ skipped: true })
      } finally {
        await lock.end()
      }
    })
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
