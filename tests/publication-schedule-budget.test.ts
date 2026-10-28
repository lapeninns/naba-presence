import { afterEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ claims: 0 }))

vi.mock("@/lib/server/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/env")>()
  const env = actual.serverEnvSchema.parse({
    DATABASE_URL: "postgresql://localhost/nabapresence",
    NEXTAUTH_SECRET: "n".repeat(32),
    TOKEN_ENCRYPTION_KEY: "t".repeat(32),
    CRON_SECRET: "c".repeat(16),
  })
  return { ...actual, getServerEnv: () => env }
})

vi.mock("@/lib/server/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/db")>()),
  getDatabase: () => async (strings: TemplateStringsArray) => {
    expect(strings.join("?")).toContain("claim_due_publication_schedules")
    state.claims += 1
    return []
  },
}))

const { runDueSchedules } =
  await import("@/lib/server/publication-schedule-runner")

describe("scheduled publication batch budget", () => {
  afterEach(() => {
    state.claims = 0
    vi.restoreAllMocks()
  })

  it("claims at the default provider timeout even when the clock advances between reads", async () => {
    let now = 0
    vi.spyOn(Date, "now").mockImplementation(() => now++)

    await runDueSchedules({ budgetMs: 15_000, requestId: "exact-budget" })

    expect(state.claims).toBe(1)
  })

  it("does not claim when less than one provider timeout is available", async () => {
    vi.spyOn(Date, "now").mockReturnValue(0)

    await runDueSchedules({ budgetMs: 14_999, requestId: "short-budget" })

    expect(state.claims).toBe(0)
  })

  it("still claims when the budget has spare time", async () => {
    let now = 0
    vi.spyOn(Date, "now").mockImplementation(() => now++)

    await runDueSchedules({ budgetMs: 20_000, requestId: "spare-budget" })

    expect(state.claims).toBe(1)
  })
})
