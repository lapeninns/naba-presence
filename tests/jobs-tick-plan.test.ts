import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { serverEnvSchema, type ServerEnv } from "@/lib/server/env"

/**
 * The tick plan of `runDueJobs` (audit 2026-10-14, W8-02/W8-05/W8-09):
 * scheduled posts before the queue, a bulk reserve the queue cannot take,
 * items started only while a provider call fits, unstarted claims handed
 * back, and every runner after the queue caught on its own.
 */

const GOOGLE_TIMEOUT_MS = 100

const env: ServerEnv = serverEnvSchema.parse({
  DATABASE_URL: "postgresql://localhost/nabapresence",
  NEXTAUTH_SECRET: "n".repeat(32),
  TOKEN_ENCRYPTION_KEY: "t".repeat(32),
  CRON_SECRET: "c".repeat(16),
  GOOGLE_TIMEOUT_MS: String(GOOGLE_TIMEOUT_MS),
  JOBS_BATCH_SIZE: "6",
  JOBS_CONCURRENCY: "2",
  PUBLISH_ENABLED: "true",
  SYNC_ENABLED: "true",
  JOBS_ENABLED: "true",
})

type Event = { at: number; what: string; detail?: unknown }

const state = vi.hoisted(() => ({
  events: [] as Event[],
  claimed: 0,
  /** How long one recurring sync takes. */
  syncMs: 10,
  /** Claims answered before the queue reads as drained; Infinity never drains. */
  claimsBeforeEmpty: Infinity,
  bulkThrows: false,
  started: new Set<string>(),
  released: [] as string[],
}))

function record(what: string, detail?: unknown) {
  state.events.push({ at: Date.now(), what, detail })
}

vi.mock("@/lib/server/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/env")>()),
  getServerEnv: () => env,
}))

vi.mock("@/lib/server/db", () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?")
    if (text.includes("from claim_due_jobs(")) {
      if (state.claimed >= state.claimsBeforeEmpty) return Promise.resolve([])
      const batch = Array.from({ length: Number(values[0]) }, () => {
        state.claimed += 1
        return {
          kind: "reconcile",
          jobId: `job-${state.claimed}`,
          organisationId: `org-${state.claimed % 7}`,
          externalLocationId: `loc-${state.claimed}`,
          syncType: "reconcile",
          retryCount: 0,
        }
      })
      record("claim", batch.length)
      return Promise.resolve(batch)
    }
    if (text.includes("release_unstarted_job(")) {
      state.released.push(String(values[2]))
    }
    return Promise.resolve([])
  }
  return {
    getDatabase: () => sql,
    withTenant: vi.fn(),
  }
})

vi.mock("@/lib/server/pause-controls", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/pause-controls")>()
  return { ...actual, loadPauseSnapshot: async () => actual.NO_PAUSES }
})

vi.mock("@/lib/server/reviews", () => ({
  syncLinkedLocation: async (input: { externalLocationId: string }) => {
    state.started.add(input.externalLocationId)
    await new Promise((resolve) => setTimeout(resolve, state.syncMs))
    return { status: "succeeded" }
  },
}))

vi.mock("@/lib/server/publication-schedule-runner", () => ({
  sweepScheduledOccurrences: async () => ({}),
  runDueSchedules: async (options: { budgetMs: number }) => {
    record("schedules", options.budgetMs)
    return { schedules: 0 }
  },
}))

vi.mock("@/lib/server/bulk-listing-runner", () => ({
  runDueBulkChildren: async (options: { budgetMs: number }) => {
    record("bulk", options.budgetMs)
    if (state.bulkThrows) throw new Error("owner lookup failed")
    return { children: 0 }
  },
}))

vi.mock("@/lib/server/privacy/withdrawals", () => ({
  runDuePrivacyWithdrawals: async () => {
    record("privacy")
    return { withdrawals: 0 }
  },
}))

vi.mock("@/lib/server/invitations/delivery", () => ({
  runDueInvitationDeliveries: async () => {
    record("invitations")
    return { deliveries: 0 }
  },
}))

vi.mock("@/lib/server/billing/process-events", () => ({
  processBillingEvents: async () => undefined,
}))

vi.mock("@/lib/server/ai-credits", () => ({
  releaseStaleReservations: async () => undefined,
}))

vi.mock("@/lib/server/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/server/keywords", () => ({ syncDueKeywords: vi.fn() }))
vi.mock("@/lib/server/performance", () => ({ syncDuePerformance: vi.fn() }))
vi.mock("@/lib/server/webhooks", () => ({ settleWebhookEvent: vi.fn() }))
vi.mock("@/lib/server/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("@/lib/server/entitlement-policy", () => ({
  organisationWriteBlock: vi.fn(),
}))
vi.mock("@/lib/server/publishing", () => ({
  recoverAttempt: vi.fn(),
  retryPublishAttempt: vi.fn(),
  writePublishAttemptEvent: vi.fn(),
}))
vi.mock("@/lib/server/mutation-recovery", () => ({
  MUTATION_RECOVER_SCOPES: ["publish", "mutation_recover"],
  recoverMutationOperation: vi.fn(),
  settleMutationRecoveryFailure: vi.fn(),
}))
vi.mock("@/lib/server/mutation-recovery-registry", () => ({
  recoveryDeps: vi.fn(),
}))

const { runDueJobs } = await import("@/lib/server/jobs")

const firstAt = (what: string) =>
  state.events.findIndex((event) => event.what === what)

/**
 * Runs one tick on the fake clock: every provider call is a timer, so time
 * moves only as far as the work does, whatever the machine's load.
 */
async function tick(options: Parameters<typeof runDueJobs>[0]) {
  const run = runDueJobs(options)
  await vi.runAllTimersAsync()
  return run
}

describe("runDueJobs tick plan", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-10-21T12:00:00Z") })
    state.events = []
    state.claimed = 0
    state.syncMs = 10
    state.claimsBeforeEmpty = Infinity
    state.bulkThrows = false
    state.started = new Set()
    state.released = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("runs scheduled posts before the queue, and bulk on its reserve, while the sync queue never empties", async () => {
    const budgetMs = 1_000
    const start = Date.now()
    await tick({ budgetMs, requestId: "tick-1" })

    expect(firstAt("schedules")).toBe(0)
    expect(firstAt("claim")).toBeGreaterThan(firstAt("schedules"))
    const bulk = state.events.find((event) => event.what === "bulk")!
    // The backlog never drained, yet bulk was reached with at least one
    // provider call's worth of the tick left: enough for its claim.
    expect(bulk.detail as number).toBeGreaterThanOrEqual(GOOGLE_TIMEOUT_MS)
    expect(bulk.at - start).toBeLessThan(budgetMs)
    expect(firstAt("privacy")).toBeGreaterThan(firstAt("bulk"))
    expect(firstAt("invitations")).toBeGreaterThan(firstAt("privacy"))
  })

  it("lends the bulk reserve back to the queue", async () => {
    await tick({ budgetMs: 1_000, requestId: "tick-2" })
    const bulkIndex = firstAt("bulk")
    expect(
      state.events.slice(bulkIndex).some((event) => event.what === "claim")
    ).toBe(true)
  })

  it("starts an item only while a provider call fits, and hands unstarted claims straight back", async () => {
    // Each sync outlasts the margin, so the tail of a batch cannot start.
    state.syncMs = 150
    const start = Date.now()
    await tick({ budgetMs: 400, requestId: "tick-3" })
    const elapsed = Date.now() - start

    expect(state.released.length).toBeGreaterThan(0)
    for (const id of state.released) {
      // Released by job id; the location id carries the same number.
      expect(state.started.has(id.replace("job-", "loc-"))).toBe(false)
    }
    // Every claimed job either ran or was released.
    expect(state.started.size + state.released.length).toBe(state.claimed)
    // No item started past budget minus one call, so the last one ends
    // within one call's worth of the budget (exact: the clock is fake).
    expect(elapsed).toBeGreaterThan(0)
    expect(elapsed).toBeLessThanOrEqual(400 + state.syncMs)
  })

  it("keeps running privacy and invitations when the bulk runner throws", async () => {
    state.bulkThrows = true
    state.claimsBeforeEmpty = 0
    await expect(
      tick({ budgetMs: 500, requestId: "tick-4" })
    ).resolves.toMatchObject({ bulk: undefined })
    expect(firstAt("privacy")).toBeGreaterThan(firstAt("bulk"))
    expect(firstAt("invitations")).toBeGreaterThan(firstAt("bulk"))
  })
})
