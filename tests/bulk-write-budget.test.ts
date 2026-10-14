import { describe, expect, it, vi } from "vitest"

// The receipt row the child's intent has, or none.
const receipt = vi.hoisted(() => ({ row: null as unknown }))

vi.mock("@/lib/server/db", () => ({
  withTenant: async (
    _organisationId: string,
    callback: (sql: unknown) => Promise<unknown>
  ) => callback(async () => (receipt.row ? [receipt.row] : [])),
}))

describe("a bulk child the write session refused for lack of time", () => {
  it.each([
    ["before any receipt", null],
    ["with its receipt settled failed", { id: "r1", state: "failed", errorCode: "google_write_budget_exhausted" }],
  ])("is deferred to a later claim %s, not failed", async (_name, row) => {
    receipt.row = row
    const { outcomeOfThrownWrite } = await import(
      "@/lib/server/bulk-families/shared"
    )
    const { GoogleWriteBudgetExhaustedError } = await import(
      "@/lib/server/google/transport"
    )
    await expect(
      outcomeOfThrownWrite(
        "org",
        "intent",
        new GoogleWriteBudgetExhaustedError()
      )
    ).resolves.toEqual({
      kind: "deferred",
      code: "google_write_budget_exhausted",
    })
  })
})
