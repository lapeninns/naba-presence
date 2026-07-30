import { describe, expect, it } from "vitest"

import { classifyMutationFailure } from "@/lib/domain/retry"

describe("mutation failure classification", () => {
  it("treats 5xx responses to mutations as ambiguous, never auto-retried", () => {
    expect(classifyMutationFailure({ kind: "http", status: 500 })).toBe(
      "ambiguous"
    )
    expect(classifyMutationFailure({ kind: "http", status: 502 })).toBe(
      "ambiguous"
    )
    expect(classifyMutationFailure({ kind: "http", status: 408 })).toBe(
      "ambiguous"
    )
  })

  it("treats network/timeout faults as ambiguous", () => {
    expect(classifyMutationFailure({ kind: "network" })).toBe("ambiguous")
    expect(classifyMutationFailure({ kind: "timeout" })).toBe("ambiguous")
  })

  it("treats 429 as retryable (not applied)", () => {
    expect(classifyMutationFailure({ kind: "http", status: 429 })).toBe(
      "retryable"
    )
  })

  it("treats other 4xx as terminal", () => {
    expect(classifyMutationFailure({ kind: "http", status: 400 })).toBe(
      "failed"
    )
    expect(classifyMutationFailure({ kind: "http", status: 404 })).toBe(
      "failed"
    )
  })
})
