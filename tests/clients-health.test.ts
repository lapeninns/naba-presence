import { describe, expect, it } from "vitest"

import {
  clientFreshness,
  clientHealth,
  FRESHNESS_WINDOW_MS,
  freshnessSentence,
  healthDescription,
  healthLabel,
  healthTone,
  summariseHealth,
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
    // Needs reconnect is an expired or revoked login WITH its reconnect
    // task. Expired alone is the platform retrying a refresh (Degraded).
    expect(
      health({
        connections: [connection({ status: "expired", reconnectRequired: true })],
      })
    ).toBe("disconnected")
    expect(
      health({
        connections: [
          connection({ status: "expired", lastErrorCode: "google_token_unavailable" }),
        ],
      })
    ).toBe("attention")
  })

  it("treats a reconnect task as disconnected even while the row says active", () => {
    expect(
      health({ connections: [connection({ reconnectRequired: true })] })
    ).toBe("disconnected")
  })

  it("asks for action when any of a client's logins needs reconnecting", () => {
    // Partly working used to read as a softer "attention", but a person
    // still has to do something, so it is Action needed.
    expect(
      health({
        connections: [connection(), connection({ status: "revoked" })],
      })
    ).toBe("disconnected")
  })

  it("prefers a failed backfill over a running one", () => {
    expect(health({ backfill: { running: 1, failed: 0 } })).toBe("syncing")
    expect(health({ backfill: { running: 1, failed: 1 } })).toBe("attention")
  })

  it("judges freshness by successful checks, never by token refreshes", () => {
    const longAgo = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const recently = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString()
    // A quiet client whose checks succeed is up to date however long it has
    // been since a refresh.
    expect(
      health({
        connections: [connection({ lastRefreshAt: longAgo })],
        checks: {
          stalestCheckAt: recently,
          lastSuccessfulCheckAt: recently,
          accessLost: 0,
        },
      })
    ).toBe("healthy")
    // And a fresh refresh does not hide checks that stopped succeeding.
    const stale = new Date(NOW.getTime() - FRESHNESS_WINDOW_MS - 1000).toISOString()
    expect(
      health({
        connections: [connection({ lastRefreshAt: recently })],
        checks: { stalestCheckAt: stale, lastSuccessfulCheckAt: stale, accessLost: 0 },
      })
    ).toBe("attention")
  })
})

describe("clientFreshness", () => {
  const base = {
    connections: [connection()],
    linkedLocationCount: 1,
    backfill: { running: 0, failed: 0 },
    now: NOW,
  }
  const recently = new Date(NOW.getTime() - 60_000).toISOString()
  const stale = new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString()

  it("shows a Google outage or rate limit as Data delayed, never Action needed", () => {
    expect(
      clientFreshness({
        ...base,
        connections: [connection({ lastErrorCode: "google_token_unavailable" })],
        checks: { stalestCheckAt: stale, lastSuccessfulCheckAt: stale, accessLost: 0 },
      })
    ).toEqual({
      state: "data_delayed",
      reason: "google_unavailable",
      lastSuccessfulCheckAt: stale,
    })
    expect(
      clientFreshness({
        ...base,
        connections: [connection({ lastErrorCode: "google_rate_limited" })],
        checks: { stalestCheckAt: recently, lastSuccessfulCheckAt: recently, accessLost: 0 },
      }).state
    ).toBe("data_delayed")
  })

  it("asks for action on a rejected credential, naming a missing permission", () => {
    expect(
      clientFreshness({
        ...base,
        connections: [connection({ status: "revoked", reconnectRequired: true })],
      })
    ).toMatchObject({ state: "action_needed", reason: "reconnect_required" })
    expect(
      clientFreshness({
        ...base,
        connections: [
          connection({
            status: "revoked",
            reconnectRequired: true,
            lastErrorCode: "insufficient_scope",
          }),
        ],
      })
    ).toMatchObject({ state: "action_needed", reason: "permission_missing" })
  })

  it("treats one listing's lost access apart from the login", () => {
    const result = clientFreshness({
      ...base,
      checks: { stalestCheckAt: recently, lastSuccessfulCheckAt: recently, accessLost: 1 },
    })
    expect(result).toMatchObject({
      state: "action_needed",
      reason: "listing_access_lost",
    })
    // The fix is at the business, not a reconnect.
    expect(freshnessSentence(result)).not.toMatch(/reconnect/i)
  })

  it("is up to date when every listing was checked within the window", () => {
    expect(
      clientFreshness({
        ...base,
        checks: { stalestCheckAt: recently, lastSuccessfulCheckAt: recently, accessLost: 0 },
      })
    ).toEqual({ state: "up_to_date", reason: null, lastSuccessfulCheckAt: recently })
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
      label: "1 client needs action",
    })
    expect(summariseHealth(["healthy", "attention"])).toEqual({
      tone: "attention",
      label: "1 client's data delayed",
    })
  })

  it("reports the calm states plainly", () => {
    expect(summariseHealth(["healthy", "healthy"])).toEqual({
      tone: "healthy",
      label: "All clients up to date",
    })
    expect(summariseHealth(["healthy", "syncing"]).label).toBe("Importing reviews")
    expect(summariseHealth([]).label).toBe("No clients yet")
    expect(summariseHealth(["not_connected"]).label).toBe("Not connected yet")
  })
})
