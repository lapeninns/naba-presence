import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  updates: [] as { text: string; values: unknown[] }[],
  settle: vi.fn(),
}))
vi.mock("@/lib/server/db", () => ({
  jsonColumn: (_sql: unknown, value: unknown) => ({ json: value }),
  withTenant: async (
    _id: string,
    callback: (
      sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown
    ) => unknown
  ) =>
    callback((strings, ...values) => {
      mocks.updates.push({ text: strings.join("?"), values })
      return []
    }),
}))
vi.mock("@/lib/server/gbp-management", () => ({
  settleGbpMutation: mocks.settle,
  stableGoogleHash: (value: unknown) => JSON.stringify(value),
}))
vi.mock("@/lib/server/google", async () => {
  const transport = await import("@/lib/server/google/transport")
  return {
    GoogleMutationAmbiguousError: transport.GoogleMutationAmbiguousError,
  }
})

import { executeAndConfirmGbpMutation } from "@/lib/server/gbp-confirmation"

const live = { pets: { petsAllowed: true } }

function executionWrite() {
  // The second update records the execution outcome and Google's answer.
  const write = mocks.updates.find((update) =>
    update.text.includes("google_response")
  )
  if (!write) throw new Error("No execution outcome was recorded.")
  return { executionState: write.values[0], googleResponse: write.values[1] }
}

beforeEach(() => {
  mocks.updates.length = 0
  vi.clearAllMocks()
})

describe("executeAndConfirmGbpMutation", () => {
  it.each([
    ["no body", null],
    ["a body that is not the resource", "<html>ok</html>"],
    ["a list", [live]],
  ])(
    "records a 2xx with %s as an unknown execution and caches only the readback",
    async (_name, answer) => {
      const onObserved = vi.fn()
      const result = await executeAndConfirmGbpMutation({
        organisationId: "o1",
        mutationId: "m1",
        payload: live,
        updateMask: ["pets"],
        execute: async () => answer as unknown as Record<string, unknown>,
        observe: async () => live,
        onObserved,
      })

      expect(executionWrite()).toEqual({
        executionState: "unknown",
        googleResponse: null,
      })
      // The readback, not the answer, decides and is what gets cached.
      expect(onObserved).toHaveBeenCalledWith(live)
      expect(result).toMatchObject({
        status: "succeeded",
        executionState: "unknown",
        confirmationState: "confirmed",
      })
    }
  )

  it("leaves an unreadable answer unresolved when the readback does not match", async () => {
    const result = await executeAndConfirmGbpMutation({
      organisationId: "o1",
      mutationId: "m1",
      payload: live,
      updateMask: ["pets"],
      execute: async () => null as unknown as Record<string, unknown>,
      observe: async () => ({ pets: { petsAllowed: false } }),
      onObserved: vi.fn(),
    })

    expect(result).toMatchObject({
      status: "ambiguous",
      executionState: "unknown",
      confirmationState: "unresolved",
    })
    expect(mocks.settle).toHaveBeenCalledWith(
      expect.objectContaining({ mutationId: "m1", status: "ambiguous" })
    )
  })

  it("records the resource Google returned as an accepted execution", async () => {
    await executeAndConfirmGbpMutation({
      organisationId: "o1",
      mutationId: "m1",
      payload: live,
      updateMask: ["pets"],
      execute: async () => live,
      observe: async () => live,
      onObserved: vi.fn(),
    })

    expect(executionWrite()).toEqual({
      executionState: "accepted",
      googleResponse: { json: live },
    })
  })
})
