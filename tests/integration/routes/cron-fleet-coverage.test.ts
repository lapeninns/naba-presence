import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

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

const CRON_BEARER = "Bearer route-harness-cron-secret"

describeDatabase("cron coverage of every organisation", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    stub = await startGoogleStub()
    stub.respond({ method: "GET", pathIncludes: "/reviews" }, () => ({
      status: 200,
      json: { reviews: [] },
    }))
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      GOOGLE_TIMEOUT_MS: "3000",
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  function cronGet(path: string) {
    return fetch(`${server.baseUrl}${path}`, {
      headers: { authorization: CRON_BEARER },
    })
  }

  async function linkedTenant() {
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
    return {
      owner,
      externalLocationId: linked.externalLocationId,
      googleLocationName: linked.googleLocationName,
    }
  }

  function sweepCheckpoint(externalLocationId: string) {
    return admin<
      { status: string; due: boolean | null; pageToken: string | null }[]
    >`
      select
        status,
        next_attempt_at <= now() as due,
        page_token as "pageToken"
      from sync_checkpoint
      where external_location_id = ${externalLocationId}
        and sync_type = 'sweep'
    `
  }

  it("queues a sweep for every organisation, once a day, under a heartbeat", async () => {
    const first = await linkedTenant()
    const second = await linkedTenant()
    const parked = await linkedTenant()
    const dead = await linkedTenant()
    const recent = await linkedTenant()
    // A sweep that ran out of pages keeps its cursor and waits for a re-arm.
    await admin`
      insert into sync_checkpoint (
        organisation_id, external_location_id, sync_type, status, next_attempt_at,
        page_token, last_error_code, finished_at
      )
      values
        (${parked.owner.organisationId}, ${parked.externalLocationId}, 'sweep',
          'failed', null, 'resume-here', 'sweep_incomplete', now() - interval '1 hour'),
        (${dead.owner.organisationId}, ${dead.externalLocationId}, 'sweep',
          'dead', null, null, 'location_not_found', now() - interval '3 days'),
        (${recent.owner.organisationId}, ${recent.externalLocationId}, 'sweep',
          'succeeded', null, null, null, now() - interval '1 hour')
    `
    const [before] = await admin<{ beatAt: Date | null }[]>`
      select beat_at as "beatAt" from ops_heartbeat where name = 'sweep'
    `

    const response = await cronGet("/api/sync/sweep")
    expect(response.status, await response.clone().text()).toBe(200)
    const body = (await response.json()) as {
      skipped: boolean
      processed: number
      queued: number
      nextCursor: string | null
    }
    expect(body).toMatchObject({ skipped: false, nextCursor: null })
    // Every tenant above is in one call, not one per daily fire.
    expect(body.processed).toBeGreaterThanOrEqual(3)
    expect(body.queued).toBeGreaterThanOrEqual(3)

    for (const tenant of [first, second]) {
      expect(await sweepCheckpoint(tenant.externalLocationId)).toEqual([
        { status: "pending", due: true, pageToken: null },
      ])
    }
    expect(await sweepCheckpoint(parked.externalLocationId)).toEqual([
      { status: "failed", due: true, pageToken: "resume-here" },
    ])
    // A permanent failure waits for a person; a sweep that just finished is
    // not repeated the same day.
    expect((await sweepCheckpoint(dead.externalLocationId))[0]).toMatchObject({
      status: "dead",
      due: null,
    })
    expect((await sweepCheckpoint(recent.externalLocationId))[0]).toMatchObject({
      status: "succeeded",
      due: null,
    })

    const [after] = await admin<{ beatAt: Date }[]>`
      select beat_at as "beatAt" from ops_heartbeat where name = 'sweep'
    `
    expect(after?.beatAt).toBeInstanceOf(Date)
    expect(after.beatAt.getTime()).toBeGreaterThanOrEqual(
      before?.beatAt?.getTime() ?? 0
    )

    // The job runner works the queue: the first tenant's sweep is claimed
    // and read from Google, then settled either way.
    for (let tick = 0; tick < 10; tick += 1) {
      const [row] = await sweepCheckpoint(first.externalLocationId)
      if (row && !["pending", "running"].includes(row.status)) break
      const jobs = await cronGet("/api/jobs/run")
      expect(jobs.status, await jobs.clone().text()).toBe(200)
    }
    expect(
      ["pending", "running"].includes(
        (await sweepCheckpoint(first.externalLocationId))[0]?.status ?? "pending"
      )
    ).toBe(false)
    expect(
      stub.calls.some((call) => call.path.includes(first.googleLocationName))
    ).toBe(true)
  }, 120_000)

  /** Last successful reconcile per location, as the freshness model reads it. */
  async function reconciledSince(externalLocationIds: string[], since: Date) {
    const rows = await admin<{ count: number }[]>`
      select count(*)::int as count
      from sync_checkpoint
      where external_location_id in ${admin(externalLocationIds)}
        and sync_type = 'reconcile'
        and last_succeeded_at >= ${since}
    `
    return rows[0]?.count ?? 0
  }

  it("enqueues reconcile for every organisation and the runner reaches them all", async () => {
    const tenants = [await linkedTenant(), await linkedTenant(), await linkedTenant()]
    const started = new Date()
    const enqueue = await cronGet("/api/sync/reconcile?maxOrganisations=1")
    expect(enqueue.status, await enqueue.clone().text()).toBe(200)
    const body = (await enqueue.json()) as {
      skipped: boolean
      processed: number
      nextCursor: null
    }
    // No page size applies any more: one fire covers the whole fleet.
    expect(body.skipped).toBe(false)
    expect(body.processed).toBeGreaterThanOrEqual(3)
    expect(body.nextCursor).toBeNull()

    for (let tick = 0; tick < 10; tick += 1) {
      const ids = tenants.map((tenant) => tenant.externalLocationId)
      if ((await reconciledSince(ids, started)) === ids.length) break
      const run = await cronGet("/api/jobs/run")
      expect(run.status, await run.clone().text()).toBe(200)
    }
    expect(
      await reconciledSince(
        tenants.map((tenant) => tenant.externalLocationId),
        started
      )
    ).toBe(3)
    // The next run is booked on the 15-minute grid, not left empty.
    const [next] = await admin<{ minutes: number }[]>`
      select min(extract(epoch from (next_attempt_at - now())) / 60)::float as minutes
      from sync_checkpoint
      where external_location_id = ${tenants[0].externalLocationId}
        and sync_type = 'reconcile'
    `
    expect(next.minutes).toBeGreaterThan(0)
    expect(next.minutes).toBeLessThanOrEqual(15)
  }, 180_000)

  it("does not claim a location whose login is waiting on a reconnect", async () => {
    const tenant = await linkedTenant()
    const [connection] = await admin<{ id: string }[]>`
      select google_connection_id::text as id
      from external_location where id = ${tenant.externalLocationId}
    `
    await admin`
      insert into connection_task (
        organisation_id, google_connection_id, task_type, status, reason_code
      )
      values (
        ${tenant.owner.organisationId}, ${connection.id}, 'reconnect', 'open',
        'invalid_grant'
      )
    `
    await cronGet("/api/sync/reconcile")
    stub.calls.length = 0
    const run = await cronGet("/api/jobs/run")
    expect(run.status).toBe(200)
    expect(
      stub.calls.some((call) => call.path.includes(tenant.googleLocationName))
    ).toBe(false)
  }, 120_000)
})
