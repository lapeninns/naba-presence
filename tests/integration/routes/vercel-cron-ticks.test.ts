import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const CRON_BEARER = "Bearer route-harness-cron-secret"

// The seven Vercel Cron paths from `vercel.json`, with the scheduler-parity
// page sizes. The harness database ships seeded organisations, so these prove
// the GET shims walk a real (small) fleet exactly the way the scheduler's
// POSTs did — same auth, same single-page shapes, same cron-branch isolation.
const ticks = [
  "/api/jobs/run",
  "/api/sync/reconcile?maxOrganisations=100",
  "/api/sync/presence-resources?maxOrganisations=10&maxLocations=5",
  "/api/sync/performance?maxOrganisations=100&maxLocations=25",
  "/api/sync/sweep",
  "/api/sync/keywords?maxOrganisations=100&maxLocations=10",
  "/api/cron/retention?batch_size=100",
]

describeDatabase("vercel cron tick shims", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>

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
    await admin.end()
  })

  function cronGet(path: string, headers: Record<string, string> = {}) {
    return fetch(`${server.baseUrl}${path}`, { headers })
  }

  function authed(path: string) {
    return cronGet(path, { authorization: CRON_BEARER })
  }

  async function schedulerHeartbeat(): Promise<number> {
    const [row] = await admin<{ beatAt: Date | null }[]>`
      select beat_at as "beatAt" from ops_heartbeat where name = 'scheduler'
    `
    return row?.beatAt?.getTime() ?? 0
  }

  it("rejects every tick without the cron bearer", async () => {
    for (const tick of ticks) {
      const response = await cronGet(tick)
      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toMatchObject({
        error: "invalid_cron_token",
      })
    }
  })

  it("drains due work through GET /api/jobs/run and stamps the heartbeat", async () => {
    const before = await schedulerHeartbeat()
    const response = await authed("/api/jobs/run")
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    for (const key of ["webhooks", "checkpoints", "attempts", "dead"]) {
      expect(typeof body[key]).toBe("number")
    }
    // Monotonic, not strictly greater: sequential files share this database,
    // so another file's tick may have stamped between our two reads.
    expect(await schedulerHeartbeat()).toBeGreaterThanOrEqual(before)
    expect(await schedulerHeartbeat()).toBeGreaterThan(0)
  })

  it("walks the fleet through GET /api/sync/reconcile", async () => {
    const response = await authed("/api/sync/reconcile?maxOrganisations=100")
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(typeof body.processed).toBe("number")
    expect(body.nextCursor === null || typeof body.nextCursor === "string").toBe(
      true
    )
    expect(Array.isArray(body.failures)).toBe(true)
    // The cron branch never carries the session-only locations payload.
    expect("locations" in body).toBe(false)
  })

  it("walks the fleet through GET /api/sync/presence-resources", async () => {
    const response = await authed(
      "/api/sync/presence-resources?maxOrganisations=10&maxLocations=5"
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      skipped: false,
      outcomes: expect.any(Array),
      truncated: false,
    })
  })

  it("walks the fleet through GET /api/sync/performance", async () => {
    const response = await authed(
      "/api/sync/performance?maxOrganisations=100&maxLocations=25"
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      organisations: expect.any(Array),
      skipped: false,
      failures: expect.any(Array),
    })
  })

  it(
    "walks the fleet through GET /api/sync/sweep",
    async () => {
      const response = await authed(
        "/api/sync/sweep"
      )
      expect(response.status).toBe(200)
      const body = (await response.json()) as Record<string, unknown>
      expect(typeof body.processed).toBe("number")
      expect(typeof body.queued).toBe("number")
      expect(body.nextCursor).toBeNull()
      expect(Array.isArray(body.failures)).toBe(true)
      expect("locations" in body).toBe(false)
    },
    120_000
  )

  it("walks the fleet through GET /api/sync/keywords", async () => {
    const response = await authed(
      "/api/sync/keywords?maxOrganisations=100&maxLocations=10"
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      organisations: expect.any(Array),
      skipped: false,
      failures: expect.any(Array),
    })
  })

  it("sweeps retention through GET /api/cron/retention", async () => {
    const response = await authed("/api/cron/retention?batch_size=100")
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      organisations: expect.any(Array),
      failures: expect.any(Array),
    })
  })

  it("rejects non-numeric page sizes with a 400, not a silent default", async () => {
    const response = await authed("/api/sync/reconcile?maxOrganisations=lots")
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
    })
  })
})
