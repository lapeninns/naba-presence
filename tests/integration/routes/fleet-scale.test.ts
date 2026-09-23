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
const FLEET = 150

/**
 * Acceptance: with 150 organisations, every organisation is reconciled
 * within 20 minutes and swept within 24 hours.
 *
 * Test conditions (docs/runbook.md, "Fleet coverage"): one linked location
 * per organisation, the runner's production defaults for batch size,
 * concurrency, per-organisation cap and Google pacing, and a local Google
 * stub answering every review list at once. One `GET /api/jobs/run` stands
 * for one minute of Vercel Cron, so the tick count is the minute count. Any
 * other tenants left in the shared test database are due too and compete
 * for the same ticks, which only makes the bound harder to meet.
 */
describeDatabase("fleet coverage at 150 organisations", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  const locations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 4 })
    stub = await startGoogleStub()
    stub.respond({ method: "GET", pathIncludes: "/reviews" }, () => ({
      status: 200,
      json: { reviews: [], totalReviewCount: 0 },
    }))
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      GOOGLE_TIMEOUT_MS: "5000",
      // Production defaults, including the shared Google budget.
      GOOGLE_API_REQUESTS_PER_MINUTE: "240",
      GOOGLE_LOCATION_EDITS_PER_MINUTE: "8",
    })
    for (let index = 0; index < FLEET; index += 1) {
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
      locations.push(linked.externalLocationId)
    }
  }, 600_000)

  afterAll(async () => {
    await server?.stop()
    await stub?.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  }, 600_000)

  function cronGet(path: string) {
    return fetch(`${server.baseUrl}${path}`, {
      headers: { authorization: CRON_BEARER },
    })
  }

  async function covered(syncType: string, since: Date) {
    const [row] = await admin<{ count: number }[]>`
      select count(distinct organisation_id)::int as count
      from sync_checkpoint
      where external_location_id in ${admin(locations)}
        and sync_type = ${syncType}
        and last_succeeded_at >= ${since}
    `
    return row.count
  }

  /**
   * One tick is one minute of production time, but the test cannot wait a
   * real minute between ticks. After each tick the minute is simulated for
   * everything time-based that the fleet's work depends on: this fleet's
   * due times, and the shared Google budget's windows and Retry-After
   * blocks, all move one minute into the past. Nothing else is touched.
   */
  async function advanceOneMinute() {
    await admin`
      update sync_checkpoint
      set next_attempt_at = next_attempt_at - interval '1 minute'
      where external_location_id in ${admin(locations)}
        and next_attempt_at > now()
    `
    await admin`
      update google_rate_bucket
      set
        window_started_at = window_started_at - interval '1 minute',
        blocked_until = blocked_until - interval '1 minute'
    `
  }

  async function ticksUntilCovered(
    syncType: string,
    since: Date,
    limit: number
  ) {
    const progress: number[] = []
    for (let tick = 1; tick <= limit; tick += 1) {
      const response = await cronGet("/api/jobs/run")
      expect(response.status, await response.clone().text()).toBe(200)
      const count = await covered(syncType, since)
      progress.push(count)
      if (count === FLEET) {
        console.info(`[fleet-scale] ${syncType} coverage by tick: ${progress.join(", ")}`)
        return tick
      }
      await advanceOneMinute()
    }
    console.info(`[fleet-scale] ${syncType} coverage by tick: ${progress.join(", ")}`)
    return null
  }

  it("reconciles every organisation within 20 one-minute ticks", async () => {
    const started = new Date()
    const enqueue = await cronGet("/api/sync/reconcile")
    expect(enqueue.status, await enqueue.clone().text()).toBe(200)

    const ticks = await ticksUntilCovered("reconcile", started, 20)
    // Reported so the run records the measured figure, not just a pass.
    console.info(
      `[fleet-scale] reconcile covered ${FLEET} organisations in ${ticks} tick(s)`
    )
    expect(ticks).not.toBeNull()
    expect(ticks!).toBeLessThanOrEqual(20)
  }, 1_800_000)

  it("sweeps every organisation from one daily enqueue", async () => {
    const started = new Date()
    // Clears the once-a-day guard for these locations only.
    await admin`
      update sync_checkpoint
      set finished_at = now() - interval '2 days'
      where external_location_id in ${admin(locations)}
        and sync_type = 'sweep'
    `
    const enqueue = await cronGet("/api/sync/sweep")
    expect(enqueue.status, await enqueue.clone().text()).toBe(200)

    // 24 hours is 1,440 ticks; the bound asserted is far tighter.
    const ticks = await ticksUntilCovered("sweep", started, 30)
    console.info(
      `[fleet-scale] sweep covered ${FLEET} organisations in ${ticks} tick(s)`
    )
    expect(ticks).not.toBeNull()
  }, 1_800_000)
})
