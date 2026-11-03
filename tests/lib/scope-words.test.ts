import { describe, expect, it } from "vitest"

import {
  clientScopeWords,
  scopeHealthWords,
  STALE_HEALTH_WORDS,
} from "@/lib/clients/scope-words"

describe("scopeHealthWords", () => {
  it("says a scoped client's own health", () => {
    expect(
      scopeHealthWords({
        mode: "agency",
        client: { health: "attention" },
        healths: ["attention", "healthy"],
      })
    ).toEqual({ tone: "attention", words: "Needs attention" })
  })

  it("rolls up every client for All clients, the same at every size", () => {
    const words = scopeHealthWords({
      mode: "agency",
      client: null,
      healths: ["attention", "partially_checked"],
    })
    // Attention outranks "need checking": one roll-up, never two wordings.
    expect(words).toEqual({
      tone: "attention",
      words: "1 client needs attention",
    })
  })

  it("counts the clients to check in the roll-up", () => {
    expect(
      scopeHealthWords({
        mode: "agency",
        client: null,
        healths: ["partially_checked"],
      })
    ).toEqual({ tone: "neutral", words: "1 client needs checking" })
  })

  it("never names clients in a business", () => {
    expect(
      scopeHealthWords({
        mode: "business",
        client: { health: "attention" },
        healths: ["attention"],
      }).words
    ).toBe("Needs attention")
  })

  it("says the numbers are last known after a failed refetch", () => {
    expect(
      scopeHealthWords({
        mode: "agency",
        client: { health: "healthy" },
        healths: ["healthy"],
        stale: true,
      })
    ).toEqual({ tone: "attention", words: STALE_HEALTH_WORDS })
  })

  it("has no words while the list loads", () => {
    expect(
      scopeHealthWords({ mode: "agency", client: null, healths: null }).words
    ).toBeNull()
  })

  it("matches the scope rows' health words for a client", () => {
    const client = { locationCount: 9, health: "attention" as const }
    expect(clientScopeWords(client)).toBe(
      `9 listings · ${scopeHealthWords({ mode: "agency", client, healths: [] }).words}`
    )
  })
})
