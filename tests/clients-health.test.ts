import { describe, expect, it } from "vitest"

import { emptyListingSummary } from "@/lib/contracts/location-summary"
import {
  COMPARISON_FRESHNESS_MS,
  listingHealth,
  listingHealthLabel,
} from "@/lib/listings/health"

import {
  clientFreshness,
  CLIENT_HEALTH,
  clientHealth,
  compareClientsByNeed,
  connectionNeedsReconnect,
  diagnoseClient,
  HEALTH_FILTERS,
  FRESHNESS_WINDOW_MS,
  attentionDescription,
  freshnessSentence,
  healthBucket,
  healthDescription,
  healthLabel,
  healthSeverity,
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
    canonicalChecks: {
      total: 2,
      checked: 2,
      partial: 0,
      attention: 0,
      unpublished: 0,
    },
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
        connections: [
          connection({ status: "expired", reconnectRequired: true }),
        ],
      })
    ).toBe("disconnected")
    expect(
      health({
        connections: [
          connection({
            status: "expired",
            lastErrorCode: "google_token_unavailable",
          }),
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
    // still has to do something, so it is disconnected.
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
    const longAgo = new Date(
      NOW.getTime() - 7 * 24 * 60 * 60 * 1000
    ).toISOString()
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
    const stale = new Date(
      NOW.getTime() - FRESHNESS_WINDOW_MS - 1000
    ).toISOString()
    expect(
      health({
        connections: [connection({ lastRefreshAt: recently })],
        checks: {
          stalestCheckAt: stale,
          lastSuccessfulCheckAt: stale,
          accessLost: 0,
        },
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
        connections: [
          connection({ lastErrorCode: "google_token_unavailable" }),
        ],
        checks: {
          stalestCheckAt: stale,
          lastSuccessfulCheckAt: stale,
          accessLost: 0,
        },
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
        checks: {
          stalestCheckAt: recently,
          lastSuccessfulCheckAt: recently,
          accessLost: 0,
        },
      }).state
    ).toBe("data_delayed")
  })

  it("asks for action on a rejected credential, naming a missing permission", () => {
    expect(
      clientFreshness({
        ...base,
        connections: [
          connection({ status: "revoked", reconnectRequired: true }),
        ],
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
      checks: {
        stalestCheckAt: recently,
        lastSuccessfulCheckAt: recently,
        accessLost: 1,
      },
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
        checks: {
          stalestCheckAt: recently,
          lastSuccessfulCheckAt: recently,
          accessLost: 0,
        },
      })
    ).toEqual({
      state: "up_to_date",
      reason: null,
      lastSuccessfulCheckAt: recently,
    })
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
      label: "1 client needs attention",
    })
  })

  it("reports the calm states plainly", () => {
    expect(summariseHealth(["healthy", "healthy"])).toEqual({
      tone: "healthy",
      label: "All clients in sync",
    })
    expect(summariseHealth(["healthy", "syncing"]).label).toBe(
      "Importing reviews"
    )
    expect(summariseHealth([]).label).toBe("No clients yet")
    expect(summariseHealth(["not_connected"]).label).toBe("Not connected yet")
  })
})

describe("health filters", () => {
  const all: ClientHealth[] = [
    "healthy",
    "syncing",
    "attention",
    "disconnected",
    "not_connected",
  ]

  it("puts every client in exactly one bucket", () => {
    // Overlapping buckets let one client count on two tiles.
    const buckets = HEALTH_FILTERS.filter((filter) => filter.value !== "all")
    for (const state of all) {
      expect(
        buckets.filter((filter) => filter.value === healthBucket(state))
      ).toHaveLength(1)
    }
  })

  it("lists the buckets most urgent first, as the chip strip draws them", () => {
    const order = HEALTH_FILTERS.map((filter) => filter.value)
    expect(order).toEqual([
      "all",
      "disconnected",
      "attention",
      "unpublished",
      "partially_checked",
      "unchecked",
      "not_connected",
      "healthy",
    ])
    const severities = order
      .filter((value) => value !== "all")
      .map((value) => healthSeverity(value as ClientHealth))
    expect(severities).toEqual([...severities].sort((a, b) => a - b))
  })

  it("labels each bucket with the same word as the pill", () => {
    for (const filter of HEALTH_FILTERS) {
      if (filter.value === "all") continue
      expect(filter.label).toBe(healthLabel(filter.value))
    }
  })

  it("says in plain words what is partly checked, not a clipped half-sentence", () => {
    expect(healthLabel("partially_checked")).toBe(
      "Some listings not checked yet"
    )
    expect(healthLabel("partially_checked")).not.toMatch(/partially/i)
  })

  it("does not promise automatic recovery for canonical comparison problems", () => {
    expect(healthLabel("attention")).toBe("Needs attention")
    expect(healthDescription("attention")).not.toMatch(
      /nothing for you to do|retry on our own/i
    )
  })
})

describe("diagnoseClient", () => {
  const withEmail = (overrides: Partial<ConnectionHealthInput> = {}) => ({
    ...connection(overrides),
    googleEmail: "ops@example.test",
  })

  it("asks for a reconnect only when a login is broken", () => {
    const broken = withEmail({ reconnectRequired: true })
    expect(
      diagnoseClient({
        health: "disconnected",
        connections: [broken],
        freshness: {
          state: "action_needed",
          reason: "reconnect_required",
          lastSuccessfulCheckAt: null,
        },
      })
    ).toMatchObject({ kind: "reconnect", connection: broken })
  })

  it("sends a lost listing to the business, not to a reconnect", () => {
    expect(
      diagnoseClient({
        health: "disconnected",
        connections: [withEmail()],
        freshness: {
          state: "action_needed",
          reason: "listing_access_lost",
          lastSuccessfulCheckAt: null,
        },
        checks: {
          stalestCheckAt: null,
          lastSuccessfulCheckAt: null,
          accessLost: 2,
        },
      })
    ).toMatchObject({ kind: "access_lost", accessLost: 2 })
  })

  it("has nothing to say about a delayed or healthy client", () => {
    expect(
      diagnoseClient({
        health: "attention",
        connections: [withEmail({ lastErrorCode: "rate_limited" })],
        freshness: {
          state: "data_delayed",
          reason: "google_unavailable",
          lastSuccessfulCheckAt: null,
        },
      })
    ).toBeNull()
  })

  it("falls back to the connections for an older response", () => {
    expect(
      diagnoseClient({
        health: "disconnected",
        connections: [withEmail({ status: "revoked" })],
      })
    ).toMatchObject({ kind: "reconnect" })
  })

  it("does not treat an expired access token as a broken login", () => {
    expect(connectionNeedsReconnect(connection({ status: "expired" }))).toBe(
      false
    )
    expect(
      connectionNeedsReconnect(connection({ reconnectRequired: true }))
    ).toBe(true)
  })
})

describe("healthBucket", () => {
  it("maps every health state to a chip the filter strip draws", () => {
    // The clients index filters with healthBucket(client.health) === chip,
    // so a state without its own chip would be unreachable from any filter.
    expect(
      Object.fromEntries(
        CLIENT_HEALTH.map((state) => [state, healthBucket(state)])
      )
    ).toEqual({
      not_connected: "not_connected",
      disconnected: "disconnected",
      attention: "attention",
      syncing: "healthy",
      healthy: "healthy",
      unchecked: "unchecked",
      partially_checked: "partially_checked",
      unpublished: "unpublished",
    })
    const chips = new Set<string>(HEALTH_FILTERS.map((filter) => filter.value))
    for (const state of CLIENT_HEALTH)
      expect(chips.has(healthBucket(state))).toBe(true)
  })

  it("counts an importing client as In sync", () => {
    expect(healthBucket("syncing")).toBe("healthy")
  })
})

describe("compareClientsByNeed", () => {
  const client = (
    name: string,
    state: ClientHealth,
    needsReply = 0,
    awaitingApproval = 0
  ) => ({ name, health: state, openWork: { needsReply, awaitingApproval } })

  it("orders by health severity, then open work, then name", () => {
    const sorted = [
      client("Healthy busy", "healthy", 9, 1),
      client("Importing", "syncing"),
      client("Not set up", "not_connected"),
      client("Unchecked", "unchecked", 1),
      client("Partial", "partially_checked", 4),
      client("Unpublished", "unpublished"),
      client("Attention", "attention"),
      client("Broken quiet", "disconnected"),
      client("Broken busy", "disconnected", 1, 2),
      client("Healthy a", "healthy", 2),
      client("Healthy b", "healthy", 0, 2),
    ].sort(compareClientsByNeed)
    expect(sorted.map((entry) => entry.name)).toEqual([
      "Broken busy",
      "Broken quiet",
      "Attention",
      "Partial",
      "Unchecked",
      "Unpublished",
      "Not set up",
      "Healthy busy",
      "Healthy a",
      "Healthy b",
      "Importing",
    ])
  })

  it("ranks a broken login above any amount of open work on a healthy client", () => {
    expect(
      compareClientsByNeed(
        client("Broken", "disconnected"),
        client("Busy", "healthy", 40)
      )
    ).toBeLessThan(0)
    expect(healthSeverity("disconnected")).toBeLessThan(
      healthSeverity("attention")
    )
    expect(healthSeverity("not_connected")).toBeGreaterThan(
      healthSeverity("unchecked")
    )
  })
})

describe("attentionDescription", () => {
  it("never says checks are up to date next to an attention state", () => {
    const upToDate = {
      state: "up_to_date" as const,
      reason: null,
      lastSuccessfulCheckAt: null,
    }
    expect(freshnessSentence(upToDate)).toMatch(/up to date/i)
    for (const freshness of [upToDate, null, undefined]) {
      const text = attentionDescription(freshness)
      expect(text).toBe(healthDescription("attention"))
      expect(text).not.toMatch(/up to date/i)
    }
  })

  it("names the cause when the freshness has one", () => {
    expect(
      attentionDescription({
        state: "action_needed",
        reason: "listing_access_lost",
        lastSuccessfulCheckAt: null,
      })
    ).toMatch(/lost manager access/)
  })
})

// From the former listing-comparison-health.test.ts: the cases
// tests/components/listing-health.test.ts does not already pin.
describe("listing comparisons feeding client health", () => {
  const observedAt = new Date(NOW.getTime() - 60_000).toISOString()
  function checked() {
    const summary = emptyListingSummary({
      locationId: "l1",
      linked: true,
      verified: true,
    })
    summary.connection = {
      status: "active",
      reconnectRequired: false,
      googleEmail: null,
    }
    summary.profile = { status: "in_sync", dirtyCount: 0, observedAt }
    summary.hours = { ...summary.profile }
    summary.menu = { ...summary.profile, eligible: false }
    return summary
  }

  it("words a partly compared listing the way the clients list does", () => {
    expect(listingHealthLabel("partially_checked")).toBe(
      "Some areas not checked yet"
    )
  })

  it("does not confirm an area whose comparison is overdue", () => {
    const summary = checked()
    const now = NOW.getTime()
    expect(listingHealth({ linked: true, summary, now })).toBe("healthy")
    summary.hours.observedAt = new Date(
      now - COMPARISON_FRESHNESS_MS - 1
    ).toISOString()
    expect(listingHealth({ linked: true, summary, now })).toBe(
      "partially_checked"
    )
  })

  it("does not call review-only client freshness fully checked", () => {
    expect(
      clientHealth({
        connections: [connection()],
        linkedLocationCount: 1,
        backfill: { running: 0, failed: 0 },
        now: NOW,
        checks: {
          stalestCheckAt: NOW.toISOString(),
          lastSuccessfulCheckAt: NOW.toISOString(),
          accessLost: 0,
        },
      })
    ).toBe("unchecked")
  })
})
