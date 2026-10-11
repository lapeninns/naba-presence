import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ServerEnv } from "@/lib/server/env"

// loadReadinessInputs with every read stubbed: what it reads, and that a
// read which never answers cannot hold the answer past the read limits.

const never = () => new Promise<never>(() => {})

const stubs = vi.hoisted(() => ({
  selectOne: vi.fn<() => Promise<unknown>>(),
  loadPauseSnapshot: vi.fn<() => Promise<unknown>>(),
  readAppliedMigrations: vi.fn<() => Promise<Set<string>>>(),
  schedulerLiveness: vi.fn<() => Promise<unknown>>(),
}))

vi.mock("@/lib/server/db", () => ({
  // `select 1` and the incident aggregate both come through here.
  getDatabase: () => () => stubs.selectOne(),
}))

vi.mock("@/lib/server/env", () => ({
  // Every env switch on: nothing paused by the env layer.
  getServerEnv: () =>
    new Proxy(
      { EMAIL_PROVIDER: "none", OPS_ALERT_EMAILS: [] },
      {
        get: (target, key) =>
          key in target
            ? target[key as keyof typeof target]
            : String(key).endsWith("_ENABLED") || undefined,
      }
    ) as unknown as ServerEnv,
}))

vi.mock("@/lib/server/pause-controls", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/pause-controls")>()),
  loadPauseSnapshot: () => stubs.loadPauseSnapshot(),
}))

vi.mock("@/lib/server/schema-compat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/schema-compat")>()),
  readAppliedMigrations: () => stubs.readAppliedMigrations(),
}))

vi.mock("@/lib/server/ops-liveness", () => ({
  schedulerLiveness: () => stubs.schedulerLiveness(),
}))

vi.mock("@/lib/server/notifications/email", () => ({
  emailConfigured: () => false,
}))

const { READINESS_READ_TIMEOUT_MS, readiness } =
  await import("@/lib/server/readiness")
const { REQUIRED_MIGRATIONS } = await import("@/lib/server/schema-manifest")

describe("readiness reads", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    stubs.selectOne.mockResolvedValue([])
    stubs.loadPauseSnapshot.mockResolvedValue({
      paused: new Set(),
      readFailed: false,
    })
    stubs.readAppliedMigrations.mockResolvedValue(new Set(REQUIRED_MIGRATIONS))
    stubs.schedulerLiveness.mockResolvedValue({
      schedulerHeartbeatAt: new Date().toISOString(),
      schedulerHeartbeatStale: false,
      schedulerTicks: [],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  /** Resolves `promise` with timers advanced by at most `ms`, or throws. */
  async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
    let settled = false
    const tracked = promise.finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(ms)
    expect(settled).toBe(true)
    return tracked
  }

  it("bounds a pause read that never answers, and reports the state unknown", async () => {
    stubs.loadPauseSnapshot.mockImplementation(never)
    const answer = await within(readiness(), READINESS_READ_TIMEOUT_MS)
    expect(answer.database.reachable).toBe(true)
    expect(answer.pause).toEqual({ scopes: [], readFailed: true })
    expect(answer.reasons.map((reason) => reason.code)).toContain(
      "pause_state_unknown"
    )
  })

  it("runs the reads after the connectivity check together, so hung reads cost one limit", async () => {
    stubs.loadPauseSnapshot.mockImplementation(never)
    stubs.readAppliedMigrations.mockImplementation(never)
    stubs.schedulerLiveness.mockImplementation(never)
    const answer = await within(readiness(), READINESS_READ_TIMEOUT_MS)
    expect(answer.schema.compatible).toBeNull()
    expect(answer.scheduler).toBeNull()
  })

  it("reads nothing else when the database is unreachable", async () => {
    stubs.selectOne.mockImplementation(never)
    const answer = await within(readiness(), READINESS_READ_TIMEOUT_MS)
    expect(answer.status).toBe("not_ready")
    expect(answer.database.reachable).toBe(false)
    expect(answer.pause.readFailed).toBe(true)
    expect(stubs.selectOne).toHaveBeenCalledTimes(1)
    expect(stubs.loadPauseSnapshot).not.toHaveBeenCalled()
    expect(stubs.readAppliedMigrations).not.toHaveBeenCalled()
    expect(stubs.schedulerLiveness).not.toHaveBeenCalled()
    expect(answer.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining(["database_unreachable"])
    )
    expect(answer.reasons.map((reason) => reason.code)).not.toContain(
      "pause_state_unknown"
    )
  })
})
