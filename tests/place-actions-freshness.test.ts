import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Session } from "@/lib/server/session"

// W3-2 (WP-11): the booking links editor is served from its last Google
// read within the editors' staleness budget: no Google call, one read-only
// transaction. Past the budget, on `refresh`, while a link write is
// unsettled, or after a writer dropped the observation, it reads Google.

const state = vi.hoisted(() => ({
  transactions: 0,
  writes: 0,
  mutation: null as null | Record<string, unknown>,
  observation: null as null | { payload: unknown; failed: boolean },
}))
const google = vi.hoisted(() => ({
  metadata: vi.fn(),
  links: vi.fn(),
  token: vi.fn(async () => "synthetic-token"),
}))
const observations = vi.hoisted(() => ({ record: vi.fn() }))

const link = {
  name: "locations/l1/placeActionLinks/1",
  providerType: "MERCHANT",
  isEditable: true,
  uri: "https://book.invalid/",
  placeActionType: "DINING_RESERVATION",
  isPreferred: true,
  createTime: null,
  updateTime: null,
}
const storedLink = {
  id: "pl1",
  googleLinkName: link.name,
  providerType: link.providerType,
  isEditable: true,
  uri: link.uri,
  placeActionType: link.placeActionType,
  isPreferred: true,
  googleHash: "h".repeat(64),
  observedAt: new Date("2026-10-14T12:00:00Z"),
}

function sqlFor() {
  return vi.fn(async (strings: TemplateStringsArray) => {
    const text = strings.join("?")
    if (/\b(insert|update|delete)\b/i.test(text)) state.writes += 1
    if (text.includes("from place_action_mutation"))
      return state.mutation ? [state.mutation] : []
    if (text.includes("from place_action_link")) return [storedLink]
    return []
  })
}

vi.mock("@/lib/server/db", () => ({
  withTenant: async (_id: string, callback: (sql: unknown) => unknown) => {
    state.transactions += 1
    return callback(sqlFor())
  },
}))
vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({}),
  gbpWritesEnabled: () => true,
}))
vi.mock("@/lib/server/gbp-write", () => ({
  loadLinkedLocation: async () => ({
    locationId: "l1",
    externalLocationId: "e1",
    googleLocationName: "locations/l1",
    googleConnectionId: "c1",
    canPublish: true,
    accessToken: google.token,
  }),
}))
vi.mock("@/lib/server/resource-observations", () => ({
  readObservedGooglePayload: async () => state.observation,
  recordResourceObservation: observations.record,
}))
vi.mock("@/lib/server/google", () => ({
  listGooglePlaceActionLinks: google.links,
}))
vi.mock("@/lib/server/google/place-action-metadata", () => ({
  listGooglePlaceActionMetadata: google.metadata,
}))

const { loadPlaceActions } = await import("@/lib/server/place-actions")

const session: Session = {
  sessionId: "s1",
  userId: "u1",
  organisationId: "o1",
  organisationName: "Test",
  workspaceMode: "business",
  displayName: "Owner",
  email: "owner@invalid.test",
  role: "owner",
  canPublish: true,
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-14T12:00:00Z"), toFake: ["Date"] })
  vi.clearAllMocks()
  state.transactions = 0
  state.writes = 0
  state.mutation = null
  state.observation = null
  google.metadata.mockImplementation(async () => ({
    supportedTypes: ["DINING_RESERVATION"],
    unsupportedTypes: [],
    observedAt: new Date().toISOString(),
  }))
  google.links.mockResolvedValue({ links: [link], unsupportedLinks: [] })
  observations.record.mockImplementation(
    async (_sql: unknown, input: { googlePayload?: unknown }) => {
      state.observation = {
        payload: input.googlePayload ?? null,
        failed: false,
      }
    }
  )
})

function resetCounters() {
  vi.clearAllMocks()
  state.transactions = 0
  state.writes = 0
}

const load = (options = {}) => loadPlaceActions("o1", session, "l1", options)

describe("Place Actions editor freshness", () => {
  it("reads Google on the first open and records links and observation in one transaction", async () => {
    const live = await load()
    expect(live.source).toBe("live")
    expect(google.metadata).toHaveBeenCalledOnce()
    expect(google.links).toHaveBeenCalledOnce()
    expect(observations.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resource: "placeActions" })
    )
    // The stored read that found nothing, then one write transaction.
    expect(state.transactions).toBe(2)
  })

  it("serves an open within the budget: no Google call, one transaction, no write, the same state", async () => {
    const live = await load()
    resetCounters()
    vi.setSystemTime(new Date("2026-10-14T12:04:59Z"))

    const stored = await load()

    expect(google.metadata).not.toHaveBeenCalled()
    expect(google.links).not.toHaveBeenCalled()
    expect(google.token).not.toHaveBeenCalled()
    expect(state.transactions).toBe(1)
    expect(state.writes).toBe(0)
    expect(observations.record).not.toHaveBeenCalled()
    expect({ ...stored, source: "live" }).toEqual(live)
  })

  it("reads Google once when stale or on refresh", async () => {
    await load()
    resetCounters()
    expect((await load({ refresh: true })).source).toBe("live")
    expect(google.links).toHaveBeenCalledOnce()
    expect(google.metadata).toHaveBeenCalledOnce()

    resetCounters()
    vi.setSystemTime(new Date("2026-10-14T12:05:01Z"))
    expect((await load()).source).toBe("live")
    expect(google.links).toHaveBeenCalledOnce()
  })

  it("reads Google while a link write is unsettled, after a failure, a dropped observation or a relink", async () => {
    await load()
    const payload = state.observation!.payload as Record<string, unknown>
    const cases: Array<() => void> = [
      () =>
        (state.mutation = {
          id: "m1",
          operation: "create",
          status: "started",
          createdAt: new Date(),
          finishedAt: null,
        }),
      () => (state.observation = { payload, failed: true }),
      () => (state.observation = { payload: null, failed: false }),
      () =>
        (state.observation = {
          payload: { ...payload, googleLocationName: "locations/other" },
          failed: false,
        }),
    ]
    for (const arrange of cases) {
      state.mutation = null
      state.observation = { payload, failed: false }
      arrange()
      resetCounters()
      expect((await load()).source).toBe("live")
      expect(google.links).toHaveBeenCalledOnce()
    }
  })
})
