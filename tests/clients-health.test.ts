import { describe, expect, it } from "vitest"

import {
  clientHealth,
  healthDescription,
  healthLabel,
  healthTone,
  summariseHealth,
  STALE_REFRESH_MS,
  type ClientHealth,
  type ConnectionHealthInput,
} from "@/lib/clients/health"

const NOW = new Date("2026-09-03T12:00:00.000Z")

const connection = (
  overrides: Partial<ConnectionHealthInput> = {}
): ConnectionHealthInput => ({
  status: "active",
  reconnectRequired: false,
  lastRefreshAt: new Date(NOW.getTime() - 60_000).toISOString(),
  ...overrides,
})

const health = (overrides: Partial<Parameters<typeof clientHealth>[0]> = {}) =>
  clientHealth({
    connections: [connection()],
    linkedLocationCount: 2,
    backfill: { running: 0, failed: 0 },
    now: NOW,
    ...overrides,
  })

describe("clientHealth", () => {
  it("is healthy when every connection is live and nothing is running", () => {
    expect(health()).toBe("healthy")
  })

  it("separates 'never set up' from 'broken'", () => {
    // The fix differs: one is "finish setup", the other is "reconnect". A
    // single word for both sends the operator to the wrong screen.
    expect(health({ linkedLocationCount: 0 })).toBe("not_connected")
    expect(health({ connections: [] })).toBe("not_connected")
    expect(health({ connections: [connection({ status: "expired" })] })).toBe(
      "disconnected"
    )
  })

  it("treats a reconnect task as disconnected even while the row says active", () => {
    expect(
      health({ connections: [connection({ reconnectRequired: true })] })
    ).toBe("disconnected")
  })

  it("flags a partly broken client rather than calling it healthy", () => {
    // The old organisation-wide health said "connected" whenever ANY
    // connection worked, which hid exactly this case.
    expect(
      health({
        connections: [connection(), connection({ status: "revoked" })],
      })
    ).toBe("attention")
  })

  it("prefers a failed backfill over a running one", () => {
    expect(health({ backfill: { running: 1, failed: 0 } })).toBe("syncing")
    expect(health({ backfill: { running: 1, failed: 1 } })).toBe("attention")
  })

  it("notices a connection that has not refreshed in a day", () => {
    const stale = new Date(NOW.getTime() - STALE_REFRESH_MS - 1000).toISOString()
    expect(health({ connections: [connection({ lastRefreshAt: stale })] })).toBe(
      "attention"
    )
    // Never refreshed is not stale: a brand-new connection has no history yet.
    expect(health({ connections: [connection({ lastRefreshAt: null })] })).toBe(
      "healthy"
    )
  })
})

describe("health vocabulary", () => {
  const all: ClientHealth[] = [
    "healthy",
    "syncing",
    "attention",
    "disconnected",
    "not_connected",
  ]

  it("gives every state a tone, a label and a sentence", () => {
    for (const state of all) {
      expect(healthTone(state)).toBeTruthy()
      expect(healthLabel(state)).toBeTruthy()
      expect(healthDescription(state)).toMatch(/\.$/)
    }
  })

  it("never describes a state in provider or internal vocabulary", () => {
    for (const state of all) {
      expect(healthDescription(state)).not.toMatch(
        /token|oauth|refresh_failed|null|undefined|API/i
      )
    }
  })
})

describe("summariseHealth", () => {
  it("counts the clients needing attention rather than picking a worst case", () => {
    // "2 clients need attention" tells an agency where to look; "attention"
    // does not.
    expect(summariseHealth(["healthy", "attention", "disconnected"])).toEqual({
      tone: "at-risk",
      label: "2 clients need attention",
    })
    expect(summariseHealth(["healthy", "attention"])).toEqual({
      tone: "attention",
      label: "1 client needs attention",
    })
  })

  it("reports the calm states plainly", () => {
    expect(summariseHealth(["healthy", "healthy"])).toEqual({
      tone: "healthy",
      label: "All clients connected",
    })
    expect(summariseHealth(["healthy", "syncing"]).label).toBe("Importing reviews")
    expect(summariseHealth([]).label).toBe("No clients yet")
    expect(summariseHealth(["not_connected"]).label).toBe("Not connected yet")
  })
})
