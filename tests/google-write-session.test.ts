import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  GOOGLE_WRITE_DEADLINE_MARGIN_MS,
  GOOGLE_WRITE_LOCK_WAIT_MAX_MS,
  GOOGLE_WRITE_MAX_DURATION_MS,
  googleWriteBudget,
} from "@/lib/server/google-write-session"

// The lock connection, faked: every statement answers `rows`, and COMMIT
// (what `begin` does once its callback resolves) fails when `commitFails`.
const connection = vi.hoisted(() => ({
  statements: [] as string[],
  rows: [{ acquired: true }] as unknown[],
  failOn: null as null | { match: string; error: unknown },
  commitFails: null as unknown,
  /** Rejects `begin` while the work is still running (postgres.js on a reset socket). */
  dropsMidWork: null as unknown,
  opened: 0,
  ended: 0,
}))

vi.mock("@/lib/server/db", () => ({
  withSessionConnection: async (
    callback: (sql: unknown) => Promise<unknown>
  ) => {
    connection.opened += 1
    return callback({
      begin: async (work: (sql: unknown) => Promise<unknown>) => {
        const sql = (strings: TemplateStringsArray) => {
          const text = strings.join("?")
          // The empty tenant fragment is not a statement of its own.
          if (!text.trim()) return Promise.resolve([])
          connection.statements.push(text)
          if (connection.failOn && text.includes(connection.failOn.match)) {
            return Promise.reject(connection.failOn.error)
          }
          return Promise.resolve(connection.rows)
        }
        const running = work(sql)
        if (connection.dropsMidWork) {
          running.catch(() => {})
          // Past the lock statements, into the work.
          await new Promise((resolve) => setTimeout(resolve, 5))
          throw connection.dropsMidWork
        }
        const value = await running
        if (connection.commitFails) throw connection.commitFails
        return value
      },
      end: async () => {
        connection.ended += 1
      },
    })
  },
}))

describe("googleWriteBudget", () => {
  const now = 1_800_000_000_000

  it("defaults the deadline to the route's maxDuration less the margin", () => {
    expect(googleWriteBudget({ now })).toEqual({
      deadline:
        now + GOOGLE_WRITE_MAX_DURATION_MS - GOOGLE_WRITE_DEADLINE_MARGIN_MS,
      lockWaitMs: GOOGLE_WRITE_LOCK_WAIT_MAX_MS,
      statementTimeoutMs: 30_000,
      idleTimeoutMs: 55_000,
    })
  })

  it("keeps an earlier caller deadline and caps a later one", () => {
    expect(googleWriteBudget({ now, deadline: now + 30_000 })?.deadline).toBe(
      now + 30_000
    )
    expect(
      googleWriteBudget({ now, deadline: now + 10 * 60_000 })?.deadline
    ).toBe(now + 50_000)
  })

  it("never lets anything it sets outlive the route's maxDuration", () => {
    for (const maxDurationMs of [15_000, 30_000, 60_000, 120_000, 300_000]) {
      for (let offset = -5_000; offset <= 400_000; offset += 2_500) {
        const budget = googleWriteBudget({
          now,
          deadline: now + offset,
          maxDurationMs,
        })
        if (!budget) {
          // Too little left to start: refused, never stretched.
          expect(
            Math.min(offset, maxDurationMs - GOOGLE_WRITE_DEADLINE_MARGIN_MS)
          ).toBeLessThanOrEqual(1_000)
          continue
        }
        const remaining = budget.deadline - now
        expect(budget.deadline).toBeLessThanOrEqual(now + offset)
        expect(budget.deadline).toBeLessThanOrEqual(
          now + maxDurationMs - GOOGLE_WRITE_DEADLINE_MARGIN_MS
        )
        // The dead-man bound on a frozen instance's lock.
        expect(budget.idleTimeoutMs).toBeLessThan(maxDurationMs)
        expect(budget.idleTimeoutMs).toBeGreaterThan(remaining)
        // A blocked waiter gets lock_timeout (a typed 409), never the
        // statement timeout, and never waits out the whole budget.
        expect(budget.lockWaitMs).toBeLessThan(budget.statementTimeoutMs)
        expect(budget.lockWaitMs).toBeLessThanOrEqual(
          GOOGLE_WRITE_LOCK_WAIT_MAX_MS
        )
        expect(budget.lockWaitMs).toBeLessThan(remaining)
        expect(budget.statementTimeoutMs).toBeLessThanOrEqual(30_000)
      }
    }
  })

  it("refuses to start with a second or less left", () => {
    expect(googleWriteBudget({ now, deadline: now + 1_000 })).toBeNull()
    expect(googleWriteBudget({ now, deadline: now - 1 })).toBeNull()
  })
})

describe("withGoogleWriteSession", () => {
  beforeEach(() => {
    connection.statements = []
    connection.rows = [{ acquired: true }]
    connection.failOn = null
    connection.commitFails = null
    connection.dropsMidWork = null
    connection.opened = 0
    connection.ended = 0
  })
  afterEach(() => vi.restoreAllMocks())

  async function load() {
    const session = await import("@/lib/server/google-write-session")
    const { log } = await import("@/lib/server/logger")
    return {
      ...session,
      warn: vi.spyOn(log, "warn").mockImplementation(() => {}),
    }
  }

  it("sets its timeouts on the lock connection, then takes each key in order", async () => {
    const { withGoogleWriteSession } = await load()
    const value = await withGoogleWriteSession(
      { surface: "test", keys: ["org:loc:a", "org:loc:b"] },
      async () => "published"
    )
    expect(value).toBe("published")
    expect(connection.statements[0]).toMatch(/set_config\('lock_timeout'/)
    expect(connection.statements[0]).toMatch(/set_config\('statement_timeout'/)
    expect(connection.statements[0]).toMatch(
      /set_config\('idle_in_transaction_session_timeout'/
    )
    expect(connection.statements.slice(1)).toEqual([
      expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringContaining("pg_advisory_xact_lock"),
    ])
  })

  it.each([
    ["the idle-in-transaction kill", { code: "25P03" }],
    ["a terminated backend", { code: "57P01" }],
    [
      "a dropped connection",
      Object.assign(new Error("closed"), { code: "CONNECTION_CLOSED" }),
    ],
  ])(
    "returns the settled result when COMMIT then fails with %s",
    async (_name, error) => {
      const { withGoogleWriteSession, warn } = await load()
      connection.commitFails = error
      const value = await withGoogleWriteSession(
        { surface: "hours", keys: ["k"] },
        async () => ({ status: "published", attemptId: "a1" })
      )
      expect(value).toEqual({ status: "published", attemptId: "a1" })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        "google_write_session.lock_lost_after_settle",
        expect.objectContaining({ surface: "hours" })
      )
    }
  )

  it("waits for work still running when the connection drops under it", async () => {
    const { withGoogleWriteSession, warn } = await load()
    connection.dropsMidWork = Object.assign(new Error("read ECONNRESET"), {
      code: "ECONNRESET",
    })
    let finished = false
    const value = await withGoogleWriteSession(
      { surface: "hours", keys: ["k"] },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        finished = true
        return "settled"
      }
    )
    expect(finished).toBe(true)
    expect(value).toBe("settled")
    expect(warn).toHaveBeenCalledTimes(1)
    expect(connection.ended).toBe(1)
  })

  it("rethrows the work's own failure when the connection drops under it", async () => {
    const { withGoogleWriteSession, warn } = await load()
    connection.dropsMidWork = { code: "25P03" }
    const failure = new Error("google said no")
    await expect(
      withGoogleWriteSession({ surface: "test", keys: ["k"] }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        throw failure
      })
    ).rejects.toBe(failure)
    expect(warn).not.toHaveBeenCalled()
    expect(connection.ended).toBe(1)
  })

  it("rethrows the work's own failure, not a later connection error", async () => {
    const { withGoogleWriteSession, warn } = await load()
    const failure = new Error("google said no")
    await expect(
      withGoogleWriteSession({ surface: "test", keys: ["k"] }, async () => {
        throw failure
      })
    ).rejects.toBe(failure)
    expect(warn).not.toHaveBeenCalled()
  })

  it("answers a lock wait that ran out with a typed 409", async () => {
    const { withGoogleWriteSession, GoogleWriteBusyError } = await load()
    connection.failOn = {
      match: "pg_advisory_xact_lock",
      error: { code: "55P03" },
    }
    const work = vi.fn()
    const request = withGoogleWriteSession(
      { surface: "test", keys: ["k"] },
      work
    )
    await expect(request).rejects.toBeInstanceOf(GoogleWriteBusyError)
    await expect(request).rejects.toMatchObject({
      status: 409,
      code: "google_write_busy",
    })
    expect(work).not.toHaveBeenCalled()
  })

  it("lets a try-lock caller answer busy itself", async () => {
    const { withGoogleWriteSession } = await load()
    connection.rows = [{ acquired: false }]
    const work = vi.fn()
    const value = await withGoogleWriteSession(
      { surface: "bulk", keys: ["k"], mode: "try", busy: () => "deferred" },
      work
    )
    expect(value).toBe("deferred")
    expect(connection.statements[1]).toContain("pg_try_advisory_xact_lock")
    expect(work).not.toHaveBeenCalled()
  })

  it("never lets a nested session outlive the session it runs in", async () => {
    const { withGoogleWriteSession } = await load()
    const outer = Date.now() + 30_000
    const inner = await withGoogleWriteSession(
      { surface: "outer", keys: ["a"], deadline: outer },
      () =>
        withGoogleWriteSession(
          { surface: "inner", keys: ["b"] },
          async ({ deadline }) => deadline
        )
    )
    expect(inner).toBe(outer)
  })

  it("refuses without connecting when the deadline leaves no time", async () => {
    const { withGoogleWriteSession, GoogleWriteBudgetExhaustedError } =
      await load()
    await expect(
      withGoogleWriteSession(
        { surface: "test", keys: ["k"], deadline: Date.now() + 500 },
        vi.fn()
      )
    ).rejects.toBeInstanceOf(GoogleWriteBudgetExhaustedError)
    expect(connection.opened).toBe(0)
  })
})
