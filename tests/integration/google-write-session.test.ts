import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { startGoogleStub, type GoogleStub } from "./helpers/google-stub"

vi.mock("server-only", () => ({}))

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

// The write session primitive against a real PostgreSQL (W4-01 / WP-02):
// lock_timeout, the session deadline on Google calls, and what happens when
// the lock connection dies after the work settled. The route-level proofs
// (hours publish) are in routes/google-write-session.test.ts.
describeDatabase("Google write session", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    google = await startGoogleStub({ port: 0 })
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL!
    process.env.NEXTAUTH_SECRET = "write-session-test-secret-32-characters!"
    process.env.CRON_SECRET = "write-session-test-cron-secret"
    process.env.GOOGLE_API_PROXY_BASE = google.baseUrl
    process.env.GOOGLE_RATE_BUDGET_ENABLED = "false"
    process.env.GOOGLE_TIMEOUT_MS = "15000"
  })

  afterAll(async () => {
    delete process.env.GOOGLE_API_PROXY_BASE
    await google?.stop()
    await admin?.end()
  })

  const lockKey = () => `write-session-test:${randomUUID()}:hours`

  /** Whether another backend can take `key` right now. */
  async function lockIsFree(key: string) {
    return admin.begin(async (sql) => {
      const [row] = await sql<{ acquired: boolean }[]>`
        select pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) as acquired`
      return row.acquired
    })
  }

  /** Holds `key` from another backend until the returned release is called. */
  async function holdLock(key: string) {
    const holder = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    let release!: () => void
    const released = new Promise<void>((resolve) => (release = resolve))
    let locked!: () => void
    const held = new Promise<void>((resolve) => (locked = resolve))
    const holding = holder.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
      locked()
      await released
    })
    await held
    return async () => {
      release()
      await holding
      await holder.end()
    }
  }

  it("answers a busy resource with a typed 409 inside the lock budget, not a 30 s statement timeout", async () => {
    const { withGoogleWriteSession, GoogleWriteBusyError } =
      await import("@/lib/server/google-write-session")
    const key = lockKey()
    const release = await holdLock(key)
    try {
      const work = vi.fn(async () => "published")
      const startedAt = performance.now()
      // 21.5 s left: the 20 s work reserve leaves a 1.5 s lock wait.
      const attempt = withGoogleWriteSession(
        { surface: "test", keys: [key], deadline: Date.now() + 21_500 },
        work
      )
      await expect(attempt).rejects.toBeInstanceOf(GoogleWriteBusyError)
      await expect(attempt).rejects.toMatchObject({
        status: 409,
        code: "google_write_busy",
      })
      const elapsed = performance.now() - startedAt
      expect(elapsed).toBeGreaterThanOrEqual(1_400)
      expect(elapsed).toBeLessThan(5_000)
      expect(work).not.toHaveBeenCalled()
    } finally {
      await release()
    }
  })

  it("ends a Google call that stalls past the deadline, and releases the lock", async () => {
    const { withGoogleWriteSession } =
      await import("@/lib/server/google-write-session")
    const { googleRequest } = await import("@/lib/server/google")
    const marker = randomUUID()
    google.respond({ method: "GET", pathIncludes: marker }, () => ({
      status: 200,
      json: {},
      delayMs: 30_000,
    }))
    const key = lockKey()
    let heldDuringWork: boolean | null = null
    const startedAt = performance.now()
    const attempt = withGoogleWriteSession(
      { surface: "test", keys: [key], deadline: Date.now() + 2_500 },
      async () => {
        heldDuringWork = !(await lockIsFree(key))
        // GOOGLE_TIMEOUT_MS is 15 s; the session deadline is what ends it.
        return googleRequest(
          `https://mybusinessbusinessinformation.googleapis.com/v1/locations/${marker}`,
          "stub-access-token"
        )
      }
    )
    await expect(attempt).rejects.toMatchObject({
      status: 502,
      code: "google_timeout",
    })
    expect(performance.now() - startedAt).toBeLessThan(5_000)
    expect(heldDuringWork).toBe(true)
    expect(await lockIsFree(key)).toBe(true)
  })

  it("returns the settled result when the idle-in-transaction kill (25P03) took the lock connection", async () => {
    const { withGoogleWriteSession } =
      await import("@/lib/server/google-write-session")
    const { log } = await import("@/lib/server/logger")
    const warn = vi.spyOn(log, "warn")
    const key = lockKey()
    const value = await withGoogleWriteSession(
      { surface: "test", keys: [key] },
      async ({ sql }) => {
        // Stands in for a Google sequence that outlived the idle budget.
        await sql`select set_config('idle_in_transaction_session_timeout', '200', true)`
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        return { status: "published", attemptId: "settled-attempt" }
      }
    )
    expect(value).toEqual({ status: "published", attemptId: "settled-attempt" })
    expect(warn).toHaveBeenCalledWith(
      "google_write_session.lock_lost_after_settle",
      expect.objectContaining({ surface: "test" })
    )
    expect(await lockIsFree(key)).toBe(true)
    warn.mockRestore()
  })

  it("returns the settled result when the lock backend is terminated (57P01)", async () => {
    const { withGoogleWriteSession } =
      await import("@/lib/server/google-write-session")
    const key = lockKey()
    const value = await withGoogleWriteSession(
      { surface: "test", keys: [key] },
      async ({ sql }) => {
        const [{ pid }] = await sql<
          { pid: number }[]
        >`select pg_backend_pid() as pid`
        await admin`select pg_terminate_backend(${pid})`
        return "settled"
      }
    )
    expect(value).toBe("settled")
    expect(await lockIsFree(key)).toBe(true)
  })

  it("sets the timeouts on the lock connection from the deadline", async () => {
    const { withGoogleWriteSession } =
      await import("@/lib/server/google-write-session")
    const settings = await withGoogleWriteSession(
      {
        surface: "test",
        keys: [lockKey()],
        organisationId: randomUUID(),
        deadline: Date.now() + 40_000,
      },
      async ({ sql }) => {
        const [row] = await sql<
          { lock: string; statement: string; idle: string; tenant: string }[]
        >`
          select
            current_setting('lock_timeout') as lock,
            current_setting('statement_timeout') as statement,
            current_setting('idle_in_transaction_session_timeout') as idle,
            current_setting('app.organisation_id', true) as tenant`
        return row
      }
    )
    const ms = (value: string) => {
      const [, amount, unit] = /^(\d+)(ms|s|min)$/.exec(value) ?? []
      return Number(amount) * (unit === "min" ? 60_000 : unit === "s" ? 1_000 : 1)
    }
    expect(ms(settings.lock)).toBe(10_000)
    expect(ms(settings.statement)).toBe(30_000)
    // 40 s left (less the time to connect) + the 5 s idle margin.
    expect(ms(settings.idle)).toBeGreaterThan(44_000)
    expect(ms(settings.idle)).toBeLessThanOrEqual(45_000)
    expect(settings.tenant).toMatch(/^[0-9a-f-]{36}$/)
  })
})
