import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("Google request pacing", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"))
    vi.spyOn(Math, "random").mockReturnValue(0.5)
    process.env.DATABASE_URL = "postgresql://runtime@example.test/naba"
    process.env.NEXTAUTH_SECRET = "n".repeat(32)
    process.env.TOKEN_ENCRYPTION_KEY = "t".repeat(32)
    process.env.CRON_SECRET = "c".repeat(16)
    process.env.GOOGLE_REQUESTS_PER_SECOND = "100"
    // This is the process-local pacer on its own; the shared Postgres budget
    // has its own tests (rate-budget.test.ts, integration/rate-budget).
    process.env.GOOGLE_RATE_BUDGET_ENABLED = "false"
  })

  afterEach(async () => {
    delete process.env.GOOGLE_RATE_BUDGET_ENABLED
    await vi.runAllTimersAsync()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("holds one connection to a four-interval request floor", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { googleRequest } = await import("@/lib/server/google")
    const connectionOptions = {
      connectionKey: "connection-a",
    } as never

    await googleRequest(
      "https://mybusiness.googleapis.com/v4/example",
      "access-token",
      {},
      connectionOptions
    )
    const second = googleRequest(
      "https://mybusiness.googleapis.com/v4/example",
      "access-token",
      {},
      connectionOptions
    )

    await vi.advanceTimersByTimeAsync(39)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await second
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
