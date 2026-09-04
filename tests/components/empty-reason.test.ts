import { describe, expect, it } from "vitest"

import { emptyCounts, emptyReason, type EmptyFacts } from "@/lib/inbox/empty-reason"

const NONE = { running: 0, failed: 0, succeeded: 0, notStarted: 0 }
const facts = (over: Partial<EmptyFacts> = {}): EmptyFacts => ({
  hasActiveFilters: false,
  totalOutsideFilters: 0,
  connection: "connected",
  clients: [],
  ...over,
})
const client = (backfill: Partial<typeof NONE>, lastSyncAt: string | null = null) => ({
  backfill: { ...NONE, ...backfill },
  lastSyncAt,
})

describe("emptyReason", () => {
  it("blames the filters before anything else when rows exist behind them", () => {
    expect(emptyReason(facts({ hasActiveFilters: true }))).toBe("filtered")
    expect(emptyReason(facts({ totalOutsideFilters: 12 }))).toBe("filtered")
  })

  it("says it does not know rather than guessing, before clients load", () => {
    // The reassuring guess — "no reviews yet" — is the one thing that must not
    // happen here: nothing has been asked, so nothing can be asserted.
    expect(emptyReason(facts({ clients: [] }))).toBe("unknown")
  })

  it("reports an import in flight ahead of an older failure", () => {
    const reason = emptyReason(
      facts({ clients: [client({ running: 1, failed: 2 })] })
    )
    expect(reason).toBe("importing")
  })

  it("only says Google has none once an import has finished", () => {
    expect(emptyReason(facts({ clients: [client({ succeeded: 3 })] }))).toBe("checked")
    // Linked but never imported must NOT read as "Google has none".
    expect(emptyReason(facts({ clients: [client({ notStarted: 2 })] }))).toBe(
      "never_imported"
    )
  })

  it("surfaces a failed import rather than an empty inbox", () => {
    expect(emptyReason(facts({ clients: [client({ failed: 1 })] }))).toBe(
      "import_failed"
    )
  })

  it("treats a connected client with no checkpoints at all as nothing linked", () => {
    expect(emptyReason(facts({ clients: [client({})] }))).toBe("not_connected")
  })

  it("puts a needed reconnect above every import fact", () => {
    const reason = emptyReason(
      facts({ connection: "disconnected", clients: [client({ succeeded: 5 })] })
    )
    expect(reason).toBe("disconnected")
  })
})

describe("emptyCounts", () => {
  it("adds up across the clients in scope and takes the newest sync", () => {
    const counted = emptyCounts(
      facts({
        clients: [
          client({ running: 1, succeeded: 2 }, "2026-09-01T00:00:00.000Z"),
          client({ running: 2, failed: 1 }, "2026-09-03T00:00:00.000Z"),
        ],
      })
    )
    expect(counted).toMatchObject({ running: 3, failed: 1, succeeded: 2 })
    expect(counted.lastSyncAt).toBe("2026-09-03T00:00:00.000Z")
  })

  it("reports no last sync when no client has one", () => {
    expect(emptyCounts(facts({ clients: [client({})] })).lastSyncAt).toBeNull()
  })
})
